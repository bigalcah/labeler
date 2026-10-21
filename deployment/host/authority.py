from __future__ import annotations

import hashlib
from pathlib import Path

import records
from consumer import fingerprint
from contracts import (Document, HASH, TARGET, now, observation, read, require, same_state,
                       shape, text, timestamp)


def authorize(runtime, action: str, binding: Document | None, observed: Document) -> Document:
    if getattr(runtime, "automation", None) is not None:
        from automatic import authorization
        return authorization(runtime, action, binding, observed)
    path = runtime.external(runtime.environment.get("LABELER_AUTHORIZATION_FILE", ""))
    require(path.stat().st_uid == 0, "authorization must be root-owned")
    request = shape(read(path), "version action actor issuedAt expiresAt candidate databaseIdentity writersStopped drain consumerSha256")
    require(type(request["version"]) is int and request["version"] == 1 and request["action"] == action,
            "fresh explicit operation authorization required")
    require(request["candidate"] == binding and request["databaseIdentity"] == observed["databaseIdentity"], "authorization candidate or DB mismatch")
    timestamp(request["issuedAt"])
    timestamp(request["expiresAt"])
    require(request["issuedAt"] <= now() < request["expiresAt"], "authorization is not current")
    authorization = records.authorization({key: request[key] for key in
        ("action", "actor", "issuedAt", "expiresAt", "writersStopped", "drain")} | {
        "requestSha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    if action == "adopt":
        require(authorization["drain"] is not None, "adoption requires push exclusion and drained v1 inventory")
    else:
        require(authorization["drain"] is None, "drain inventory belongs only to adoption authorization")
    require(request["consumerSha256"] == fingerprint()["sha256"], "installed consumer fingerprint differs from operator approval")
    return authorization


def backup(runtime, observed: Document) -> Document | None:
    if getattr(runtime, "automation", None) is not None:
        require(runtime.automation["backupRequired"] is False, "automatic backup policy mismatch")
        runtime.writers_stopped()
        return None
    runtime.stage = "backup"
    command = runtime.external(runtime.environment.get("LABELER_BACKUP_COMMAND", ""))
    require(command.stat().st_uid == 0 and command.stat().st_mode & 0o111 != 0, "backup boundary must be a root-owned executable")
    output = runtime.command([str(command)]).decode("utf-8").strip()
    require(output != "STUDY_BACKUP_VERIFIED", "backup marker is not a receipt")
    path = runtime.external(output)
    value = shape(read(path), "kind version databaseIdentity origin interval tools archive prerequisites restore writersStopped")
    require(value["kind"] == "labeler-full-postgresql-backup" and type(value["version"]) is int and value["version"] == 1,
            "typed full backup receipt required")
    require(value["databaseIdentity"] == observed["databaseIdentity"] and same_state(observation(value["origin"]), observed)
            and value["writersStopped"] is True and observed["readOnly"]["writersStopped"] is True,
            "backup does not bind the stopped origin")
    interval = shape(value["interval"], "startedAt completedAt")
    require(timestamp(interval["startedAt"]) <= timestamp(interval["completedAt"]) <= now(), "invalid backup interval")
    tools = shape(value["tools"], "pgDump pgRestore serverVersion")
    for version in tools.values():
        text(version)
    require(tools["serverVersion"] == observed["databaseIdentity"]["serverVersion"], "backup server identity mismatch")
    archive = shape(value["archive"], "format scope location sha256 encryptionKeyRef retentionUntil")
    require(archive["format"] == "custom" and archive["scope"] == "full-database", "full custom database archive required")
    archive_path = runtime.external(text(archive["location"]))
    checksum = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    require(checksum == text(archive["sha256"], HASH), "backup archive checksum mismatch")
    text(archive["encryptionKeyRef"])
    require(timestamp(archive["retentionUntil"]) > now(), "backup retention expired")
    prerequisites = shape(value["prerequisites"], "roles extensions tablespaces globals")
    for name in ("roles", "extensions", "tablespaces"):
        require(type(prerequisites[name]) is list, "missing backup prerequisites")
        for prerequisite in prerequisites[name]:
            item = shape(prerequisite, "name disposition evidenceSha256")
            text(item["name"])
            require(item["disposition"] in ("restored", "approved-mapping"), "unresolved restore prerequisite")
            text(item["evidenceSha256"], HASH)
    globals_record = shape(prerequisites["globals"], "disposition location sha256")
    require(globals_record["disposition"] in ("protected-globals", "approved-mapping"), "globals protection required")
    globals_path = runtime.external(text(globals_record["location"]))
    require(hashlib.sha256(globals_path.read_bytes()).hexdigest() == text(globals_record["sha256"], HASH), "globals evidence mismatch")
    restore = shape(value["restore"], "databaseIdentity completedAt result schemaFingerprint dataFingerprint archiveSha256")
    records.identity(restore["databaseIdentity"])
    destination = restore["databaseIdentity"]
    source = observed["databaseIdentity"]
    require(destination["systemIdentifier"] != source["systemIdentifier"]
            and destination["volume"] != source["volume"] and destination["endpoint"] != source["endpoint"], "restore must be isolated")
    require(restore["result"] == "verified" and restore["schemaFingerprint"] == observed["schemaFingerprint"]
            and restore["dataFingerprint"] == observed["fingerprint"] and restore["archiveSha256"] == checksum
            and interval["completedAt"] <= timestamp(restore["completedAt"]) <= now(), "isolated restore verification mismatch")
    fresh = runtime.observe()
    require(same_state(fresh, observed) and fresh["readOnly"]["writersStopped"] is True,
            "origin changed or writers returned after backup; recapture required")
    return {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
