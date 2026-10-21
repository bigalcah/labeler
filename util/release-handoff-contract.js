import {StudyReadinessError} from "./study-readiness.js";
import {isDeepStrictEqual} from "node:util";

const assert = condition => {
    if (!condition) throw new StudyReadinessError("Invalid typed release handoff receipt.");
};
const shape = (value, keys) => {
    assert(value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).sort().join(" ") === keys.split(" ").sort().join(" "));
};
const string = value => assert(typeof value === "string" && value.length > 0 && value.length <= 2048
    && [...value].every(character => character.charCodeAt(0) >= 32));
const hash = value => assert(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
const timestamp = value => {
    assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value));
    assert(Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace("Z", ".000Z"));
};
const identity = value => {
    shape(value, "systemIdentifier databaseOid databaseName serverVersion endpoint volume");
    Object.values(value).forEach(string);
    for (const key of ["systemIdentifier", "databaseOid", "serverVersion"]) assert(/^\d+$/.test(value[key]));
};
const observation = value => {
    shape(value, "schema dataBundle fingerprint schemaFingerprint observedAt databaseIdentity readOnly");
    assert(["empty", "study-schema-3", "study-schema-4", "001_study_foundation", "003_private_pr_discard", "004_github_pr_api_enrichment",
        "005_github_enrichment_checkpoints", "006_github_api_telemetry", "007_local_accounts_sessions", "008_login_rate_limits",
        "009_csrf_contexts", "010_study_scoped_participant_categories", "011_multi_study_cardinality",
        "012_global_normalized_username", "013_category_definition_color", "014_copilot_369_cardinality"].includes(value.schema));
    assert(["empty", "legacy300-v1", "copilot369-v1"].includes(value.dataBundle));
    hash(value.fingerprint);
    hash(value.schemaFingerprint);
    timestamp(value.observedAt);
    identity(value.databaseIdentity);
    shape(value.readOnly, "role transaction grantsVerified writersStopped");
    string(value.readOnly.role);
    assert(value.readOnly.transaction === "read-only" && value.readOnly.grantsVerified === true
        && typeof value.readOnly.writersStopped === "boolean");
};
const candidate = value => {
    shape(value, "releaseId generation commit images packageHashes");
    assert(typeof value.releaseId === "string");
    const match = value.releaseId.match(/^(0|[1-9][0-9]{0,9})-([1-9][0-9]{0,9})-([a-f0-9]{40})$/);
    assert(match && Number(match[1]) === value.generation && Number.isSafeInteger(value.generation)
        && value.generation <= 2147483647 && Number(match[2]) <= 2147483647 && value.commit === match[3]);
    shape(value.images, "server database");
    for (const image of Object.values(value.images)) {
        assert(typeof image === "string" && new RegExp(`^ghcr\\.io/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+:sha-${value.commit}@sha256:[a-f0-9]{64}$`).test(image));
    }
    shape(value.packageHashes, "Caddyfile docker-compose.yml release-manifest.json");
    Object.values(value.packageHashes).forEach(hash);
};

const assertHandoffReceipt = receipt => {
    shape(receipt, "kind version operationId candidate databaseIdentity phase predecessorEvidence authorization backupRef origin target publication");
    assert(receipt.kind === "labeler-host-operation" && receipt.version === 1 && receipt.phase === "pending"
        && /^(release|rollback)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(receipt.operationId));
    candidate(receipt.candidate);
    identity(receipt.databaseIdentity);
    observation(receipt.origin);
    assert(isDeepStrictEqual(receipt.databaseIdentity, receipt.origin.databaseIdentity));
    string(receipt.predecessorEvidence);
    assert(/^evidence\//.test(receipt.predecessorEvidence) && !receipt.predecessorEvidence.split("/").includes(".."));
    shape(receipt.authorization, "action actor issuedAt expiresAt requestSha256 writersStopped drain");
    assert(["deploy", "maintenance", "maintenance-normalize", "maintenance-history", "continue"].includes(receipt.authorization.action));
    string(receipt.authorization.actor);
    timestamp(receipt.authorization.issuedAt);
    timestamp(receipt.authorization.expiresAt);
    hash(receipt.authorization.requestSha256);
    assert(typeof receipt.authorization.writersStopped === "boolean" && receipt.authorization.drain === null);
    shape(receipt.target, "schema dataBundle observation");
    assert(receipt.target.schema === (receipt.authorization.action === "maintenance-normalize" ? "study-schema-3" : "study-schema-4")
        && receipt.target.dataBundle ===
        (["maintenance-normalize", "maintenance-history"].includes(receipt.authorization.action) ? receipt.origin.dataBundle : "copilot369-v1"));
    if (receipt.target.observation !== null) {
        observation(receipt.target.observation);
        assert(isDeepStrictEqual(receipt.databaseIdentity, receipt.target.observation.databaseIdentity)
            && receipt.target.observation.schema === receipt.target.schema
            && receipt.target.observation.dataBundle === receipt.target.dataBundle);
    }
    if (receipt.backupRef !== null) {
        shape(receipt.backupRef, "path sha256");
        string(receipt.backupRef.path);
        assert(receipt.backupRef.path.startsWith("/"));
        hash(receipt.backupRef.sha256);
    }
    if (receipt.publication !== null) {
        shape(receipt.publication, "before desired");
        for (const value of Object.values(receipt.publication)) {
            shape(value, "previous current active-schema-version deployment");
            for (const field of Object.values(value)) if (field !== null) string(field);
        }
    }
};

export {assertHandoffReceipt, observation as assertHandoffObservation};
