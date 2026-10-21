import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {createInterface} from "node:readline";
import path from "node:path";
import {docker, execute} from "./real-runtime-rehearsal-fixture.js";

const runRehearsalController = async (fixture, mode) => {
    const {directory, project, root} = fixture;
    const helper = `${project}-helper`;
    let stderr = "";
    let brokerFailure;
    const child = spawn("docker", ["run", "--rm", "--pull", "never", "--name", helper, "-i", "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--cap-add", "CHOWN", "--cap-add", "FOWNER", "--cap-add", "DAC_OVERRIDE",
        "--mount", `type=bind,src=${root},dst=/workspace,readonly`, "--mount", `type=bind,src=${root},dst=${root},readonly`,
        "--mount", `type=bind,src=${fixture.profileRoot},dst=${fixture.profileRoot},readonly`,
        "--mount", `type=bind,src=${directory},dst=${directory}`, "python:3.12-alpine", "python3", "-B",
        "/workspace/test/support/real-runtime-rehearsal-driver.py", directory, mode], {stdio: ["pipe", "pipe", "pipe"]});
    child.stderr.on("data", value => { stderr += value; });
    const exit = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", code => resolve(code)); });
    const lines = createInterface({input: child.stdout});
    let crashed = false;
    for await (const line of lines) {
        const request = JSON.parse(line);
        if (request.report === true) continue;
        assert.deepEqual(Object.keys(request).sort(), ["operation", "services"]);
        const entry = {operation: request.operation, services: request.services, mode};
        fixture.commands.push(entry);
        try {
            let output;
            switch (request.operation) {
            case "config":
                output = await fixture.compose(["config", "--format", "json"]);
                break;
            case "images": {
                const actual = JSON.parse(await docker(["image", "inspect", fixture.images.server, "--format", "{{json .Id}}"]));
                assert.equal(actual, fixture.images.server);
                const files = ["util/study-readiness.js", "scripts/study-readiness.js", "schema/migrations/014_copilot_369_cardinality.sql"];
                const hashes = await Promise.all(files.map(async file => [file, createHash("sha256").update(await readFile(path.join(root, file))).digest("hex")]));
                const command = ["run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL",
                    ...["util", "scripts", "schema"].flatMap(name => ["--mount", `type=bind,src=${path.join(root, name)},dst=/labeling/${name},readonly`]),
                    "--entrypoint", "sha256sum", actual, ...files];
                const observed = (await docker(command)).trim().split("\n");
                assert.deepEqual(observed, hashes.map(([file, hash]) => `${hash}  ${file}`));
                output = JSON.stringify({sourceHashesVerified: true, pullPerformed: false});
                break;
            }
            case "inspect-db": {
                const values = JSON.parse(await docker(["inspect", `${project}-db`]));
                for (const mount of values[0].Mounts) if (mount.Name === `${project}-data`) mount.Name = "labeling-data";
                output = JSON.stringify(values);
                break;
            }
            case "observer": {
                const mounts = fixture.model.services["labeling-study-prepare"].volumes.filter(mount => mount.type === "bind"
                    && mount.target !== "/run/secrets/database-password");
                const settings = {DATABASE_HOST: "labeling-database", DATABASE_PORT: "5432", DATABASE_NAME: "rehearsal",
                    DATABASE_USER: "labeler_inspection", DATABASE_PASS_FILE: "/run/secrets/inspection-password",
                    LABELER_READINESS_STRICT: "true", STUDY_PROFILES_INPUT: "/run/config/study-profiles.json"};
                const args = ["run", "--rm", "--pull", "never", "--network", fixture.network, "--read-only", "--cap-drop", "ALL",
                    "--mount", `type=bind,src=${path.join(fixture.nodeInputs, "inspection-password")},dst=/run/secrets/inspection-password,readonly`,
                    "--mount", `type=bind,src=${path.join(fixture.nodeInputs, "legacy.csv")},dst=/labeling/data/pr-cards.csv,readonly`,
                    ...mounts.flatMap(mount => ["--mount", `type=bind,src=${mount.source},dst=${mount.target},readonly`]),
                    ...Object.entries(settings).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
                    "--entrypoint", "node", fixture.images.server, "scripts/study-readiness.js", "--normalization-probe"];
                output = await docker(args);
                const observation = JSON.parse(output).observation;
                assert.equal(observation.readOnly.grantsVerified, true);
                assert.equal(observation.readOnly.transaction, "read-only");
                break;
            }
            case "inventory-ids":
                output = await docker(["ps", "-a", "--filter", `network=${fixture.network}`, "--format", "{{.ID}}"]);
                break;
            case "inventory-names": {
                const names = await docker(["ps", "--filter", `network=${fixture.network}`, "--format", "{{.Names}}"]);
                output = names.replaceAll(`${project}-db`, "labeling-database").replaceAll(`${project}-app`, "labeling-server")
                    .replaceAll(`${project}-edge`, "labeling-caddy");
                break;
            }
            case "inventory-inspect": {
                const ids = (await docker(["ps", "-a", "--filter", `network=${fixture.network}`, "--format", "{{.ID}}"])).trim().split("\n");
                output = await docker(["inspect", ...ids]);
                break;
            }
            case "up": {
                assert.ok(Array.isArray(request.services) && request.services.every(name => ["labeling-database", "labeling-server", "labeling-caddy"].includes(name)));
                if (mode === "runtime" || fixture.fault === "runtime") {
                    fixture.model.services["labeling-server"].environment.SESSION_SECRET_FILE = "/run/secrets/intentionally-missing";
                    await writeFile(path.join(directory, "compose.json"), JSON.stringify(fixture.model));
                }
                output = await fixture.compose(["up", "-d", "--no-build", "--pull", "never", "--no-deps", "--wait", "--wait-timeout", "20", ...request.services]);
                break;
            }
            case "prepare":
                output = await fixture.compose(["run", "--rm", "--no-deps", "--pull", "never", "labeling-study-prepare"]);
                fixture.prepareOutput = output;
                break;
            case "smoke": {
                const endpoint = (await docker(["port", `${project}-edge`, "443/tcp"])).trim();
                const certificate = path.join(directory, "caddy-root.crt");
                await docker(["cp", `${project}-edge:/data/caddy/pki/authorities/local/root.crt`, certificate]);
                if (mode === "smoke") await docker(["pause", `${project}-edge`]);
                output = (await execute("curl", ["--fail", "--silent", "--show-error", "--max-time", "3", "--cacert", certificate,
                    "--output", "/dev/null", "--write-out", "%{http_code}", `https://localhost:${endpoint.split(":").at(-1)}/login`])).stdout;
                assert.equal(output, "200");
                fixture.httpsPort = Number(endpoint.split(":").at(-1));
                break;
            }
            case "fault":
                assert.equal(mode, "rollback");
                fixture.fault = "runtime";
                output = "";
                break;
            case "checkpoint":
                assert.ok(["interrupt-origin", "interrupt-target", "unknown"].includes(mode));
                await docker(["kill", "--signal", "KILL", helper]);
                crashed = true;
                continue;
            default:
                throw new Error(`Forbidden broker operation: ${request.operation}`);
            }
            entry.code = 0;
            child.stdin.write(`${JSON.stringify({code: 0, stdout: Buffer.from(output).toString("base64")})}\n`);
        } catch (error) {
            if (typeof error.code !== "number") { brokerFailure = error; child.stdin.end(); break; }
            entry.code = error.code;
            entry.failureSha256 = createHash("sha256").update(error.stderr || "").digest("hex");
            child.stdin.write(`${JSON.stringify({code: error.code, stdout: ""})}\n`);
        }
    }
    const code = await exit;
    if (brokerFailure) throw brokerFailure;
    assert.equal(code, crashed ? 137 : 0, stderr);
    if (crashed) return {crashed: true};
    return JSON.parse(await readFile(path.join(directory, "host-output/report.json"), "utf8"));
};

export {runRehearsalController};
