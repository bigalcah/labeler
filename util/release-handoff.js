import {readFile, lstat} from "node:fs/promises";
import {isDeepStrictEqual} from "node:util";
import {createHash} from "node:crypto";
import {StudyReadinessError} from "./study-readiness.js";
import {assertHandoffReceipt, assertHandoffObservation} from "./release-handoff-contract.js";

const verifyReleaseHandoff = async (observation, purpose = "prepare") => {
    const file = process.env.LABELER_RELEASE_CONTEXT;
    if (file !== "/run/labeler-release/context.json") throw new StudyReadinessError("Untrusted release context path.");
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.uid !== 0 || metadata.gid !== 1000 || (metadata.mode & 0o777) !== 0o440 || metadata.size > 65536) {
        throw new StudyReadinessError("Release context must be a root-owned immutable handoff.");
    }
    const context = JSON.parse(await readFile(file, "utf8"));
    assertHandoffReceipt(context.receipt);
    assertHandoffObservation(context.observation);
    const normalization = purpose === "maintenance-normalize";
    const authorization = context.receipt.authorization;
    if (!["prepare", "maintenance-normalize"].includes(purpose)
        || (normalization ? authorization.action !== "maintenance-normalize"
            : !["deploy", "continue"].includes(authorization.action))
        || !(Date.parse(authorization.issuedAt) <= Date.now() && Date.now() < Date.parse(authorization.expiresAt))
        || (normalization && (authorization.writersStopped !== true || context.receipt.backupRef === null
            || context.observation.readOnly.writersStopped !== true
            || ["schema", "dataBundle", "fingerprint", "schemaFingerprint", "databaseIdentity"]
                .some(key => !isDeepStrictEqual(context.observation[key], context.receipt.origin[key]))))) {
        throw new StudyReadinessError("Release handoff action does not authorize this step.");
    }
    const keys = ["version", "operationId", "candidate", "databaseIdentity", "phase", "receipt", "receiptSha256", "observation"];
    const receiptKeys = ["kind", "version", "operationId", "candidate", "databaseIdentity", "phase", "predecessorEvidence",
        "authorization", "backupRef", "origin", "target", "publication"];
    if (!isDeepStrictEqual(Object.keys(context).sort(), keys.sort()) || context.version !== 1
        || !context.receipt || !isDeepStrictEqual(Object.keys(context.receipt).sort(), receiptKeys.sort())
        || context.phase !== "pending" || context.operationId !== context.receipt.operationId
        || context.receipt.phase !== "pending" || context.receipt.kind !== "labeler-host-operation"
        || context.receipt.version !== 1 || !isDeepStrictEqual(context.candidate, context.receipt.candidate)
        || !context.candidate || !/^(0|[1-9][0-9]*)-[1-9][0-9]*-[a-f0-9]{40}$/.test(context.candidate.releaseId)
        || context.receipt.target.schema !== "study-schema-3" || context.receipt.target.dataBundle !==
            (normalization ? context.receipt.origin.dataBundle : "copilot369-v1")
        || !isDeepStrictEqual(context.databaseIdentity, context.receipt.databaseIdentity)
        || !isDeepStrictEqual(context.databaseIdentity, context.observation.databaseIdentity)
        || createHash("sha256").update(JSON.stringify(context.receipt)).digest("hex") !== context.receiptSha256
        || context.databaseIdentity.systemIdentifier !== observation.databaseIdentity.systemIdentifier
        || context.databaseIdentity.databaseOid !== observation.databaseIdentity.databaseOid
        || context.databaseIdentity.databaseName !== observation.databaseIdentity.databaseName
        || context.databaseIdentity.serverVersion !== observation.databaseIdentity.serverVersion
        || context.observation.schema !== observation.schema
        || context.observation.dataBundle !== observation.dataBundle
        || context.observation.fingerprint !== observation.fingerprint
        || context.observation.schemaFingerprint !== observation.schemaFingerprint) {
        throw new StudyReadinessError("Release handoff does not bind this pending step, candidate and database.");
    }
    return context;
};

export {verifyReleaseHandoff};
