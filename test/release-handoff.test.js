import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import path from "node:path";
import test from "node:test";

const execute = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const driver = `
import {writeFileSync, chmodSync, chownSync} from "node:fs";
import {createHash} from "node:crypto";
import {verifyReleaseHandoff} from "/labeling/util/release-handoff.js";
const mode = process.env.FIXTURE_MODE;
const identity = {systemIdentifier:"123",databaseOid:"10",databaseName:"fixture",serverVersion:"170006",endpoint:"db:5432/fixture",volume:"fixture-volume"};
const observation = {schema:"empty",dataBundle:"empty",fingerprint:"a".repeat(64),schemaFingerprint:"b".repeat(64),databaseIdentity:identity,
    observedAt:"2026-10-17T00:00:00Z",readOnly:{role:"inspection",transaction:"read-only",grantsVerified:true,writersStopped:true}};
const candidate = {releaseId:"1-1-"+"c".repeat(40),generation:1,commit:"c".repeat(40),
    images:{server:"ghcr.io/example/server:sha-"+"c".repeat(40)+"@sha256:"+"a".repeat(64),database:"ghcr.io/example/database:sha-"+"c".repeat(40)+"@sha256:"+"b".repeat(64)},
    packageHashes:{Caddyfile:"a".repeat(64),"docker-compose.yml":"b".repeat(64),"release-manifest.json":"c".repeat(64)}};
const receipt = {kind:"labeler-host-operation",version:1,operationId:"release-00000000-0000-0000-0000-000000000001",candidate,databaseIdentity:identity,
    phase:"pending",predecessorEvidence:"evidence/fixture/reserved.json",authorization:{action:"deploy",actor:"fixture-operator",issuedAt:"2026-10-17T00:00:00Z",
        expiresAt:"2099-01-01T00:00:00Z",requestSha256:"d".repeat(64),writersStopped:true,drain:null},backupRef:null,origin:observation,
    target:{schema:"study-schema-4",dataBundle:"copilot369-v1",observation:null},publication:null};
const context = {version:1,operationId:receipt.operationId,candidate,databaseIdentity:identity,phase:"pending",receipt,
    receiptSha256:createHash("sha256").update(JSON.stringify(receipt)).digest("hex"),observation};
if(mode==="wrong-operation") context.operationId="client-operation";
if(mode==="wrong-database") context.databaseIdentity={...identity,databaseOid:"999"};
if(mode==="extra-receipt") context.receipt.extra=true;
if(mode==="normalization-prepare" || mode==="normalization-valid" || mode==="cutover-normalizer" || mode==="wrong-normalization-target") {
    receipt.authorization.action=mode==="cutover-normalizer"?"maintenance":"maintenance-normalize";
        receipt.target.schema="study-schema-3";
    receipt.target.dataBundle=mode==="wrong-normalization-target"?"copilot369-v1":"empty";
    receipt.backupRef={path:"/external/verified-backup",sha256:"f".repeat(64)};
    context.receiptSha256=createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
}
if(mode==="expired") {
    receipt.authorization.expiresAt="2020-01-01T00:00:00Z";
    context.receiptSha256=createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
}
if(mode.startsWith("history-checkpoint-")) {
    receipt.origin=structuredClone(observation);
    receipt.origin.schema="014_copilot_369_cardinality";
    observation.schema="study-schema-3";
    observation.fingerprint="e".repeat(64);
    observation.schemaFingerprint="f".repeat(64);
    receipt.authorization.action="maintenance-history";
    receipt.target.dataBundle="empty";
    receipt.backupRef={path:"/external/verified-post-normalization-backup",sha256:"f".repeat(64)};
    if(mode==="history-checkpoint-wrong-source") observation.schema="013_category_definition_color";
    if(mode==="history-checkpoint-wrong-bundle") observation.dataBundle="legacy300-v1";
    if(mode==="history-checkpoint-no-backup") receipt.backupRef=null;
    if(mode==="history-checkpoint-delegated" || mode==="history-checkpoint-invalid-delegation") {
        receipt.backupRef=null;
        receipt.authorization.automation={policySha256:"b".repeat(64),backupRequired:mode==="history-checkpoint-invalid-delegation"};
    }
    context.receiptSha256=createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
}
const file="/run/labeler-release/context.json";
writeFileSync(file,JSON.stringify(context)); chmodSync(file,0o440); chownSync(file,0,1000);
if(mode==="client-owned") chownSync(file,1000,1000);
if(mode==="wrong-group") chownSync(file,0,0);
process.env.LABELER_RELEASE_CONTEXT=file;
const actual=structuredClone(observation);
if(mode==="wrong-server-version") actual.databaseIdentity.serverVersion="170007";
if(mode==="normalization-valid") actual.readOnly={role:"writer",transaction:"read-only",grantsVerified:false,writersStopped:false};
if(mode==="history-checkpoint-drift") actual.fingerprint="0".repeat(64);
const purpose=mode.startsWith("history-checkpoint-")?"maintenance-history":
    ["normalization-valid","cutover-normalizer","wrong-normalization-target"].includes(mode)?"maintenance-normalize":"prepare";
const valid=["valid","normalization-valid","history-checkpoint-valid","history-checkpoint-delegated"].includes(mode);
try {await verifyReleaseHandoff(actual,purpose); if(!valid) process.exit(2); process.stdout.write("VERIFIED");}
catch(error) {if(valid || error.name!=="StudyReadinessError") throw error; process.stdout.write("REJECTED");}
`;

test("prepare accepts only its root-owned pending handoff and rejects client-owned or mismatched contexts", async () => {
    for (const mode of ["valid", "client-owned", "wrong-group", "wrong-operation", "wrong-database", "wrong-server-version", "extra-receipt",
        "normalization-prepare", "normalization-valid", "cutover-normalizer", "wrong-normalization-target", "expired",
        "history-checkpoint-valid", "history-checkpoint-drift", "history-checkpoint-wrong-source",
        "history-checkpoint-wrong-bundle", "history-checkpoint-no-backup",
        "history-checkpoint-delegated", "history-checkpoint-invalid-delegation"]) {
        const {stdout} = await execute("docker", ["run", "--rm", "--read-only", "--network", "none", "--user", "0",
            "--cap-drop", "ALL", "--cap-add", "CHOWN", "--tmpfs", "/run/labeler-release:rw,noexec,nosuid,nodev,mode=0700",
            "--mount", `type=bind,src=${path.join(root, "util")},dst=/labeling/util,readonly`, "-e", `FIXTURE_MODE=${mode}`,
            "--entrypoint", "node", process.env.LABELER_READINESS_TEST_IMAGE || "labeler-copilot369-local:b5cddf3", "--input-type=module", "-e", driver], {timeout: 30000});
        assert.equal(stdout, ["valid", "normalization-valid", "history-checkpoint-valid", "history-checkpoint-delegated"].includes(mode) ? "VERIFIED" : "REJECTED");
    }
});
