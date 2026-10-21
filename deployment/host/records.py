from __future__ import annotations

import re
from typing import Final

from contracts import (Document, FILES, HASH, IMAGE, Json, LIMIT, RELEASE, TARGET, encoded, identity,
                       number, observation, require, shape, text, timestamp)

PHASES: Final = ("adoption", "backup_verified", "reserved", "pending", "normalization_verified", "history_schema_verified", "cutover_verified",
                 "runtime_verified", "smoke_verified", "publication_intent", "publication_metadata",
                 "completed", "abandoned", "unknown")
RECEIPT_KEYS: Final = "kind version operationId candidate databaseIdentity phase predecessorEvidence authorization backupRef origin target publication"
JOURNAL_KEYS: Final = "formatVersion status operationId releaseId generation target databaseIdentity effectiveSchema effectiveDataBundle lastVerifiedAt evidenceRef origin"
OPERATION: Final = r"(?:adoption|release|rollback)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"


def candidate(value: Json) -> Document:
    result = shape(value, "releaseId generation commit images packageHashes")
    match = re.fullmatch(RELEASE, text(result["releaseId"], RELEASE))
    require(match is not None and number(result["generation"]) == int(match[1])
            and int(match[2]) <= 2147483647 and result["commit"] == match[3], "candidate identity mismatch")
    images = shape(result["images"], "server database")
    for image in images.values():
        matched = re.fullmatch(IMAGE, text(image))
        require(matched is not None and matched[1] == result["commit"], "candidate image mismatch")
    hashes = shape(result["packageHashes"], " ".join(FILES))
    for checksum in hashes.values():
        text(checksum, HASH)
    return result


def evidence_path(value: Json) -> str:
    result = text(value, r"evidence/(?:adoption/)?[A-Za-z0-9._/-]+\.json")
    require(all(part not in ("", ".", "..") for part in result.split("/")), "unsafe evidence path")
    return result


def authorization(value: Json) -> Document:
    result = shape(value, "action actor issuedAt expiresAt requestSha256 writersStopped drain")
    text(result["action"], r"adopt|deploy|rollback|maintenance|maintenance-normalize|maintenance-history|continue|finalize-publication|reconcile")
    text(result["actor"], r"[A-Za-z0-9._@-]{1,128}")
    timestamp(result["issuedAt"])
    timestamp(result["expiresAt"])
    text(result["requestSha256"], HASH)
    require(type(result["writersStopped"]) is bool, "invalid writer authorization")
    if result["drain"] is not None:
        drain = shape(result["drain"], "pushesExcluded rerunsBlocked ciTerminal queued running awaitingApproval retryable inFlight")
        require(all(drain[key] is True for key in ("pushesExcluded", "rerunsBlocked", "ciTerminal")), "adoption window not excluded")
        for category in ("queued", "running", "awaitingApproval", "retryable", "inFlight"):
            require(type(drain[category]) is list, "missing drain inventory")
            for operation in drain[category]:
                item = shape(operation, "id startedAt terminalAt status")
                text(item["id"])
                timestamp(item["startedAt"])
                timestamp(item["terminalAt"])
                require(item["status"] in ("completed", "cancelled"), "v1 operation not drained")
    return result


def metadata(value: Json) -> Document:
    result = shape(value, "previous current active-schema-version deployment")
    for name in ("previous", "current"):
        if result[name] is not None:
            text(result[name], "releases/" + RELEASE)
    for name in ("active-schema-version", "deployment"):
        if result[name] is not None:
            text(result[name], r"[^\x00-\x1f]{1,2048}")
    return result


def publication(value: Json) -> Document:
    result = shape(value, "before desired")
    metadata(result["before"])
    metadata(result["desired"])
    return result


def receipt(value: Json) -> Document:
    require(len(encoded(value)) <= LIMIT, "receipt exceeds 64 KiB")
    result = shape(value, RECEIPT_KEYS)
    require(result["kind"] == "labeler-host-operation" and type(result["version"]) is int
            and result["version"] == 1, "unknown receipt version")
    text(result["operationId"], OPERATION)
    require(result["phase"] in PHASES, "unknown receipt phase")
    identity(result["databaseIdentity"])
    authorization(result["authorization"])
    observation(result["origin"])
    require(result["databaseIdentity"] == result["origin"]["databaseIdentity"], "origin identity mismatch")
    if result["candidate"] is None:
        require(str(result["operationId"]).startswith("adoption-") and result["phase"] in ("adoption", "unknown"), "candidate required")
    else:
        candidate(result["candidate"])
    if result["predecessorEvidence"] is not None:
        evidence_path(result["predecessorEvidence"])
    if result["backupRef"] is not None:
        backup = shape(result["backupRef"], "path sha256")
        text(backup["path"], r"/[^\x00-\x1f]+")
        text(backup["sha256"], HASH)
    target = shape(result["target"], "schema dataBundle observation")
    step_target = {key: target[key] for key in TARGET}
    legacy = step_target == {"schema": "study-schema-3", "dataBundle": TARGET["dataBundle"]}
    normalization = (result["phase"] == "normalization_verified" or result["authorization"]["action"] == "maintenance-normalize"
        or (target["schema"] == "study-schema-3" and not legacy))
    history = (result["phase"] == "history_schema_verified" or result["authorization"]["action"] == "maintenance-history"
        or (target["schema"] == TARGET["schema"] and step_target != TARGET))
    if normalization:
        expected = {"schema": "study-schema-3", "dataBundle": result["origin"]["dataBundle"]}
    elif history:
        expected = dict(TARGET, dataBundle=result["origin"]["dataBundle"])
    else:
        expected = step_target if legacy else TARGET
    require(step_target == expected, "invalid target")
    if normalization:
        require(result["phase"] in ("reserved", "pending", "normalization_verified", "abandoned", "unknown"), "normalization cannot admit runtime")
        require(result["authorization"]["action"] in ("maintenance-normalize", "reconcile"), "normalization target requires normalization scope")
    if history:
        require(result["phase"] in ("reserved", "pending", "history_schema_verified", "abandoned", "unknown"), "history checkpoint cannot admit runtime")
        require(result["authorization"]["action"] in ("maintenance-history", "reconcile"), "history target requires history scope")
        if result["phase"] in ("pending", "history_schema_verified"):
            require(result["backupRef"] is not None and result["publication"] is not None,
                    "history handoff requires backup and publication baseline")
    if target["observation"] is not None:
        observed = observation(target["observation"])
        require(observed["databaseIdentity"] == result["databaseIdentity"]
                and observed["schema"] == target["schema"] and observed["dataBundle"] == target["dataBundle"], "invalid target observation")
    if result["phase"] in ("normalization_verified", "history_schema_verified", "cutover_verified", "runtime_verified", "smoke_verified", "publication_intent", "publication_metadata", "completed"):
        require(target["observation"] is not None, "verified transition requires actual target observation")
    if result["phase"] in ("publication_intent", "publication_metadata", "completed"):
        require(result["publication"] is not None, "publication transition requires recorded tuple")
    if result["publication"] is not None:
        publication(result["publication"])
    return result


def journal(value: Json) -> Document:
    result = shape(value, JOURNAL_KEYS)
    require(type(result["formatVersion"]) is int and result["formatVersion"] == 1, "unknown journal version")
    require(result["status"] in ("pending", "verified", "unknown"), "invalid journal status")
    text(result["operationId"], OPERATION)
    target = shape(result["target"], "schema dataBundle")
    require(target["schema"] in (TARGET["schema"], "study-schema-3") and target["dataBundle"] in
            (TARGET["dataBundle"], result["origin"]["dataBundle"]), "invalid journal target")
    identity(result["databaseIdentity"])
    observation(result["origin"])
    evidence_path(result["evidenceRef"])
    if result["releaseId"] is None:
        require(result["generation"] is None and str(result["operationId"]).startswith("adoption-"), "invalid adoption IDs")
    else:
        text(result["releaseId"], RELEASE)
        number(result["generation"])
    if result["status"] == "verified":
        text(result["effectiveSchema"])
        text(result["effectiveDataBundle"], r"empty|legacy300-v1|copilot369-v1")
        timestamp(result["lastVerifiedAt"])
    else:
        require(all(result[key] is None for key in ("effectiveSchema", "effectiveDataBundle", "lastVerifiedAt")), "unknown effective state must be null")
    return result
