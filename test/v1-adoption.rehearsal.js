import assert from "node:assert/strict";
import {chmod, writeFile} from "node:fs/promises";
import path from "node:path";
import {test} from "node:test";
import {assertSqlReadonly, createRuntimeRehearsal, docker, execute, readSqlWindow} from "./support/real-runtime-rehearsal-fixture.js";
import {runRehearsalController} from "./support/real-runtime-rehearsal-broker.js";

const baseline = process.env.LABELER_TEST_V1_IMAGE;
if (!baseline || !/^(?:sha256:[a-f0-9]{64}|ghcr\.io\/[a-z0-9/_.-]+@sha256:[a-f0-9]{64})$/.test(baseline)) {
    throw new Error("BLOCKED 10.13: LABELER_TEST_V1_IMAGE must identify an approved cached pre-v2 image by immutable ID/digest; no tag, current v2 substitution, pull or synthetic baseline is accepted");
}

test("actual approved pre-v2 app remains serving with unchanged container identity during readonly host adoption", async () => {
    const inspection = JSON.parse(await docker(["image", "inspect", baseline, "--format",
        "{{json .Id}}\n{{json .RepoDigests}}\n{{json .Config.Labels}}"])
        .then(output => JSON.stringify(output.trim().split("\n").map(line => JSON.parse(line)))));
    const [id, digests, labels] = inspection;
    const revision = labels?.["org.opencontainers.image.revision"];
    assert.match(revision || "", /^[a-f0-9]{40}$/,
        "BLOCKED 10.13: cached artifact lacks revision-bound provenance; supply the approved previous published image and its immutable identity, not a retagged development build");
    assert.ok(digests.some(digest => /^ghcr\.io\/bigalcah\/labeler-server@sha256:[a-f0-9]{64}$/.test(digest)),
        "BLOCKED 10.13: no cached published project RepoDigest");
    const source = JSON.parse(await docker(["run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--entrypoint", "node", id, "--input-type=module", "-e",
        "import fs from 'node:fs';import crypto from 'node:crypto';const s=fs.readFileSync('scripts/create-release-manifest.js','utf8');const csv=fs.readFileSync('data/pr-cards.csv');process.stdout.write(JSON.stringify({writerSha256:crypto.createHash('sha256').update(s).digest('hex'),csvSha256:crypto.createHash('sha256').update(csv).digest('hex'),v1:s.includes('schemaVersion: 1'),v2:s.includes('schemaVersion: 2'),has014:fs.existsSync('schema/migrations/014_copilot_369_cardinality.sql')}));"]));
    assert.equal(source.writerSha256, "da87df3959b47c4480326cc8637ecc800a8783524d931ca8f85739a4b00b755b");
    assert.equal(source.csvSha256, "4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef");
    assert.deepEqual({v1: source.v1, v2: source.v2, has014: source.has014}, {v1: true, v2: false, has014: false});
    const fixture = await createRuntimeRehearsal("adoption");
    try {
        const server = fixture.model.services["labeling-server"];
        server.image = id;
        server.volumes = server.volumes.filter(mount => mount.target.startsWith("/run/secrets/"));
        for (const name of ["database-password", "session-current", "session-previous"]) await chmod(path.join(fixture.directory, name), 0o400);
        await writeFile(path.join(fixture.directory, "compose.json"), JSON.stringify(fixture.model));
        await fixture.compose(["up", "-d", "--no-build", "--pull", "never", "--no-deps", "--wait", "--wait-timeout", "30", "labeling-server", "labeling-caddy"]);
        const port = (await docker(["port", `${fixture.project}-edge`, "443/tcp"])).trim().split(":").at(-1);
        const certificate = path.join(fixture.directory, "caddy-root.crt");
        await docker(["cp", `${fixture.project}-edge:/data/caddy/pki/authorities/local/root.crt`, certificate]);
        const https = async () => {
            const {stdout} = await execute("curl", ["--fail", "--silent", "--show-error", "--cacert", certificate,
                "--max-time", "5", "--output", "/dev/null", "--write-out", "%{http_code}", `https://localhost:${port}/login`]);
            assert.equal(stdout, "200");
        };
        const identity = async () => JSON.parse(await docker(["inspect", `${fixture.project}-app`, "--format",
            "{\"id\":{{json .Id}},\"startedAt\":{{json .State.StartedAt}},\"image\":{{json .Image}},\"running\":{{json .State.Running}}}"]));
        await https();
        const before = await identity();
        const sqlBefore = await readSqlWindow(fixture);
        const report = await runRehearsalController(fixture, "adoption");
        const sqlAfter = await readSqlWindow(fixture);
        const after = await identity();
        await https();
        assert.deepEqual(after, before);
        assert.equal(after.image, id);
        assert.equal(after.running, true);
        assert.equal(report.journal.releaseId, null);
        assert.equal(report.journal.generation, null);
        assert.equal(report.phase, "adoption");
        assert.equal(report.fresh.fingerprint, report.origin.fingerprint);
        assert.equal(report.fresh.schemaFingerprint, report.origin.schemaFingerprint);
        assert.deepEqual(report.publicationAfter, report.publicationBefore);
        assert.ok(report.inventory.runtime.some(value => value.id === before.id && value.startedAt === before.startedAt));
        assert.equal(fixture.commands.some(value => ["up", "prepare", "smoke"].includes(value.operation)), false);
        const count = assertSqlReadonly(sqlAfter.slice(sqlBefore.length));
        assert.ok(count > 0);
        fixture.observations = {report, before, after, baseline: {id, digests, revision, source}, readonlyStatementCount: count,
            authTransientsExcluded: ["app_session", "login_ip_attempt", "login_csrf_context", "github_api_telemetry_event"],
            githubDrainIsAttestationFixture: true, remoteAdministrativeEnforcementProved: false};
    } finally {
        await fixture.close();
    }
});
