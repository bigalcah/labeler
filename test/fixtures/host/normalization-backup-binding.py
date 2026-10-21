#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
# --- How to run ---
# 1. Install uv (if not installed):
#      curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run the integration selection from the repository root:
#      node --test --test-concurrency=1 test/study-bootstrap-ledger.integration.js
# 3. The selection launches this script with captured PostgreSQL observations in an isolated container.

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, "/workspace/deployment/host")

import authority
import contracts
from runtime import Runtime


class ObservedRuntime(Runtime):
    def __init__(self, root: Path, current: contracts.Document) -> None:
        super().__init__(root)
        self.current = current

    def observe(self) -> contracts.Document:
        return self.current


def write_backup_receipt(external: Path, origin: contracts.Document, evidence: contracts.Document) -> None:
    archive = external / "full.dump"
    globals_file = external / "globals.json"
    receipt_path = external / "receipt.json"
    shutil.copyfile(external.parent / "archive.dump", archive)
    globals_file.write_text("{}\n")
    archive.chmod(0o400)
    globals_file.chmod(0o400)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    globals_checksum = hashlib.sha256(globals_file.read_bytes()).hexdigest()
    backup_started = contracts.timestamp(evidence["backupStartedAt"])
    backup_completed = contracts.timestamp(evidence["backupCompletedAt"])
    restored_at = contracts.timestamp(evidence["restoreCompletedAt"])
    identity = origin["databaseIdentity"]
    restored = contracts.observation(evidence["restored"])
    receipt = {"kind": "labeler-full-postgresql-backup", "version": 1,
        "databaseIdentity": identity, "origin": origin,
        "interval": {"startedAt": backup_started, "completedAt": backup_completed},
        "tools": {"pgDump": "fixture", "pgRestore": "fixture", "serverVersion": identity["serverVersion"]},
        "archive": {"format": "custom", "scope": "full-database", "location": str(archive),
            "sha256": checksum, "encryptionKeyRef": "fixture-key", "retentionUntil": "2099-01-01T00:00:00Z"},
        "prerequisites": {"roles": [], "extensions": [], "tablespaces": [],
            "globals": {"disposition": "protected-globals", "location": str(globals_file), "sha256": globals_checksum}},
        "restore": {"databaseIdentity": restored["databaseIdentity"], "completedAt": restored_at, "result": "verified",
            "schemaFingerprint": restored["schemaFingerprint"], "dataFingerprint": restored["fingerprint"],
            "archiveSha256": checksum}, "writersStopped": True}
    receipt_path.write_text(json.dumps(receipt))
    receipt_path.chmod(0o400)


def main() -> None:
    fixture_root = Path("/fixture")
    host_root = fixture_root / "host"
    external = fixture_root / "external"
    host_root.mkdir(mode=0o700)
    external.mkdir(mode=0o700)
    try:
        inputs = contracts.shape(contracts.read(fixture_root / "observations.json"),
            "pre015 post015 restored backupStartedAt backupCompletedAt restoreCompletedAt")
        pre015 = contracts.observation(inputs["pre015"])
        post015 = contracts.observation(inputs["post015"])
        environment_file = external / "runtime.env"
        environment_file.write_text("DATABASE_NAME=disposable\n")
        environment_file.chmod(0o400)
        backup_command = external / "backup"
        backup_command.write_text("#!/bin/sh\nprintf '%s\\n' /fixture/external/receipt.json\n")
        backup_command.chmod(0o500)
        os.environ.update({"LABELER_ENV_FILE": str(environment_file),
            "LABELER_PUBLIC_BASE_URL": "https://localhost", "LABELER_BACKUP_COMMAND": str(backup_command)})
        runtime = ObservedRuntime(host_root, post015)

        write_backup_receipt(external, post015, inputs)
        accepted = authority.backup(runtime, post015)
        write_backup_receipt(external, pre015, inputs)
        try:
            authority.backup(runtime, post015)
        except contracts.Rejected as error:
            rejected = {"accepted": False, "reason": str(error)}
        else:
            rejected = {"accepted": True}
        print(json.dumps({"post015Accepted": accepted, "pre015": rejected}, separators=(",", ":")))
    finally:
        shutil.rmtree(host_root)
        shutil.rmtree(external)


if __name__ == "__main__":
    main()
