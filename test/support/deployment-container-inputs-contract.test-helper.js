import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import test from "node:test";

const harnessUrl = new URL("../../scripts/test-study-deployment.sh", import.meta.url);
const diagnosticUrl = new URL("./prepare-probe-diagnostic.js", import.meta.url);
const stagingUrl = new URL("./container-input-staging.js", import.meta.url);
const handoffHelperUrl = new URL("./locked-prepare-handoff.py", import.meta.url);

test("Given an empty initialized database When prepare is admitted Then the root-owned handoff remains locked", async () => {
    const harness = await readFile(harnessUrl, "utf8");
    const handoffHelper = await readFile(handoffHelperUrl, "utf8");

    assert.match(harness, /docker build --tag "\$CLEAN_PROJECT-database-fixture:latest"/);
    assert.match(harness, /up --no-build --wait --wait-timeout 240 labeling-database/);
    assert.match(harness, /requireRestrictedRole: true/);
    assert.match(harness, /STAGE_UNTRUSTED_CONTEXT_REJECTIONS_OK/);
    assert.match(harness, /Initialization requires the locked host's root-owned pending handoff/);
    assert.match(harness, /Untrusted release context path\./);
    assert.match(harness, /HANDOFF_LOCK_HELD_THROUGH_PREPARE=true/);
    assert.match(handoffHelper, /with durable\.lock\(HOST_ROOT\)/);
    assert.match(handoffHelper, /state\.reserve\(binding, origin, auth\(\)\)/);
    assert.match(handoffHelper, /state\.advance\(receipt, "pending"\)/);
    assert.match(handoffHelper, /state\.handoff\(receipt, origin, 1000\)/);
    assert.match(handoffHelper, /fcntl\.LOCK_EX \| fcntl\.LOCK_NB/);
    assert.match(handoffHelper, /HANDOFF_CLEANED/);
    assert.match(harness, /\/run\/labeler-release\/context\.json:ro/);
    assert.match(harness, /"root handoff is not mounted readonly into prepare"/);
    assert.match(harness, /host-control\/host-handoff\/context\.json:\/run\/labeler-release\/context\.json:ro/);
    assert.match(harness, /verify_clean_origin_unchanged/);
    assert.match(harness, /wait-for-docker-log\.js/);
    assert.match(harness, /database initialization log marker is missing/);
    assert.match(harness, /wait_database_initialization "\$CLEAN_PROJECT" "\$CLEAN_DIR"/);
    assert.match(harness, /wait_database_initialization "\$EXISTING_PROJECT" "\$EXISTING_DIR"/);
    assert.ok(harness.indexOf("wait_database_initialization \"$CLEAN_PROJECT\" \"$CLEAN_DIR\"")
        > harness.indexOf("up --build --wait --wait-timeout 240 labeling-database"));
    assert.match(harness, /primary-369-before\.sha256/);
    assert.match(harness, /primary-369-after\.sha256/);
});

test("deployment harness wires safe probes and existing-mode staging without changing fail-closed inputs", async () => {
    const harness = await readFile(harnessUrl, "utf8");
    const staging = await readFile(stagingUrl, "utf8");

    assert.match(harness, /report_prepare_probe_diagnostic/);
    assert.match(harness, /else\s+absent_context_status=\$\?\s+fi\s+report_prepare_probe_diagnostic absent-context/);
    assert.match(harness, /else\s+forged_context_status=\$\?\s+fi\s+report_prepare_probe_diagnostic forged-context/);
    assert.match(harness, /prepare-probe-diagnostic\.js/);
    assert.match(harness, /container-input-staging\.js/);
    assert.match(harness, /PGPASSFILE_HOST_PATH=\$runtime\/container-inputs\/legacy-retirement\.pgpass/);
    assert.match(harness, /LEGACY_BACKUP_DIRECTORY=\$runtime\/container-inputs\/backup/);
    assert.match(harness, /stage_node_container_inputs "\$runtime" legacy-retirement\.pgpass/);
    assert.equal((harness.match(/stage_node_container_inputs "\$EXISTING_DIR" backup\/legacy\.dump backup\/legacy\.manifest\.json/g) ?? []).length, 3);
    assert.match(staging, /os\.chown\(destination,1000,1000\)/);
    assert.match(staging, /os\.chmod\(destination,0o400\)/);
    assert.doesNotMatch(harness, /chown -R/);
    assert.match(harness, /\*"Initialization requires the locked host's root-owned pending handoff"\*/);
    assert.match(harness, /\*"Untrusted release context path\."\*/);
});

test("prepare-probe diagnostics classify failure categories without echoing secret-like output", () => {
    const canaries = [
        "ARBITRARY_PASSWORD_CANARY",
        "ARBITRARY_TOKEN_CANARY",
        "ARBITRARY_HASH_CANARY",
        "ARBITRARY_COOKIE_CANARY",
        "ARBITRARY_GENERIC_CANARY",
    ];
    const scenarios = [
        {probe: "absent-context", status: 1, detail: "STUDY_PROFILES_INPUT_INVALID",
            expectedMarker: false, categories: {profileValidation: true, containerStartOrMount: false,
                databaseOrReadinessPrerequisite: false, capturedMarkerMismatch: true}},
        {probe: "forged-context", status: 125, detail: "Error response from daemon: failed to create task",
            expectedMarker: false, categories: {profileValidation: false, containerStartOrMount: true,
                databaseOrReadinessPrerequisite: false, capturedMarkerMismatch: true}},
        {probe: "absent-context", status: 1, detail: "Readiness requires explicit database identity",
            expectedMarker: false, categories: {profileValidation: false, containerStartOrMount: false,
                databaseOrReadinessPrerequisite: true, capturedMarkerMismatch: true}},
        {probe: "absent-context", status: 1, detail: "database system is starting up",
            expectedMarker: false, categories: {profileValidation: false, containerStartOrMount: false,
                databaseOrReadinessPrerequisite: true, capturedMarkerMismatch: true}},
        {probe: "absent-context", status: 1, detail: "unclassified synthetic failure",
            expectedMarker: false, categories: {profileValidation: false, containerStartOrMount: false,
                databaseOrReadinessPrerequisite: false, capturedMarkerMismatch: true}},
        {probe: "forged-context", status: 1, detail: "Untrusted release context path.",
            expectedMarker: true, categories: {profileValidation: false, containerStartOrMount: false,
                databaseOrReadinessPrerequisite: false, capturedMarkerMismatch: false}},
    ];

    for (const scenario of scenarios) {
        const capturedOutput = `${canaries.join(" ")}\n${scenario.detail}`;
        const result = spawnSync(process.execPath,
            [diagnosticUrl.pathname, scenario.probe, String(scenario.status)],
            {encoding: "utf8", input: capturedOutput});

        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stderr, "");
        const evidence = JSON.parse(result.stdout);
        assert.deepEqual(Object.keys(evidence), ["probe", "status", "byteCount", "knownMarkerPresent", "errorCategories"]);
        assert.equal(evidence.probe, scenario.probe);
        assert.equal(evidence.status, scenario.status);
        assert.equal(evidence.byteCount, Buffer.byteLength(capturedOutput));
        assert.equal(evidence.knownMarkerPresent, scenario.expectedMarker);
        assert.deepEqual(evidence.errorCategories, scenario.categories);
        const sanitizedEvidence = `${result.stdout}${result.stderr}${JSON.stringify(evidence)}`;
        for (const canary of canaries) assert.equal(sanitizedEvidence.includes(canary), false);
    }
});
