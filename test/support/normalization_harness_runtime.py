from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import shutil
import signal
import threading
from pathlib import Path
from types import FrameType
from typing import assert_never

import consumer
import contracts
import publication
from state import State

FIXTURE_ROOT = Path("/fixture")
HANDOFF_ROOT = FIXTURE_ROOT / "host-handoff"
EXTERNAL_ROOT = FIXTURE_ROOT / "external"
PRE_PROBE_PATH = FIXTURE_ROOT / "normalization-pre-probe.json"
NORMALIZED_PROBE_PATH = FIXTURE_ROOT / "normalization-post-probe.json"
PREPARED_PROBE_PATH = FIXTURE_ROOT / "normalization-prepared-probe.json"
REPORT_PATH = FIXTURE_ROOT / "normalization-report.json"
CONTROL_EVENT = threading.Event()
STOP_REQUESTED = threading.Event()
RECEIVED_SIGNAL: int | None = None


def receive_signal(signal_number: int, _frame: FrameType | None) -> None:
    global RECEIVED_SIGNAL
    if signal_number == signal.SIGTERM:
        STOP_REQUESTED.set()
    else:
        RECEIVED_SIGNAL = signal_number
    CONTROL_EVENT.set()


def wait_for_signal(expected: int) -> None:
    while True:
        CONTROL_EVENT.wait()
        CONTROL_EVENT.clear()
        received_signal = RECEIVED_SIGNAL
        if STOP_REQUESTED.is_set():
            raise SystemExit(143)
        if received_signal == expected:
            return
        contracts.require(received_signal is None, "unexpected harness synchronization signal")


def write_document(path: Path, value: contracts.Json, mode: int = 0o400) -> None:
    path.write_text(json.dumps(value, separators=(",", ":")) + "\n")
    path.chmod(mode)


def write_report(value: contracts.Json) -> None:
    if REPORT_PATH.exists():
        REPORT_PATH.chmod(0o600)
    write_document(REPORT_PATH, value, 0o444)


def timestamp_after(days: int) -> str:
    value = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_authorization(action: str, binding: contracts.Document,
                       identity: contracts.Document) -> Path:
    path = EXTERNAL_ROOT / f"{action}-authorization.json"
    request = {"version": 1, "action": action, "actor": "isolated-harness-fixture",
        "issuedAt": contracts.now(), "expiresAt": timestamp_after(1), "candidate": binding,
        "databaseIdentity": identity, "writersStopped": True, "drain": None,
        "consumerSha256": consumer.fingerprint()["sha256"]}
    write_document(path, request)
    return path


class HarnessRuntime:
    def __init__(self, root: Path, state: State, binding: contracts.Document) -> None:
        self.root = root
        self.state = state
        self.binding = binding
        self.environment = {"LABELER_AUTHORIZATION_FILE": "", "LABELER_BACKUP_COMMAND": str(EXTERNAL_ROOT / "full-backup-command")}
        self.compose: list[str] = []
        self.probe_path = PRE_PROBE_PATH
        self.backup_count = 0
        self.backup_proofs: list[contracts.Document] = []
        self.events: list[str] = []

    def external(self, value: str) -> Path:
        path = Path(value)
        contracts.require(path.is_absolute() and path.is_file() and not path.is_symlink()
                          and not path.resolve().is_relative_to(self.root.resolve())
                          and path.stat().st_uid == 0 and path.stat().st_mode & 0o022 == 0,
                          "isolated fixture external file is untrusted")
        return path

    def configure(self, _directory: Path, _release: contracts.Document) -> None:
        self.compose = ["docker", "compose"]
        self.events.append("configure")

    def verify_images(self, _release: contracts.Document) -> None:
        self.events.append("image-preflight-spy")

    def verify_normalization_source(self) -> None:
        source = Path("/workspace/schema/migrations/015_normalize_retired_study_schema.sql").read_bytes()
        contracts.require(hashlib.sha256(source).hexdigest()
                          == "53f8188e453101b9a06f16e1b2891c7538aecaed8e83b954d00cf3e6a4dbf951",
                          "normalization source pin mismatch")
        self.events.append("normalization-source-pin")

    def normalization_probe(self) -> contracts.Document:
        document = contracts.read(self.probe_path)
        value = document["probe"] if type(document) is dict and "probe" in document else document
        result = contracts.shape(value, "observation applied015 eligibility")
        self.events.append("restricted-normalization-probe")
        return result

    def observe(self) -> contracts.Document:
        return self.normalization_probe()["observation"]

    def writers_stopped(self) -> None:
        self.events.append("writers-stopped-probe")

    def unchanged_mounts(self) -> None:
        self.events.append("mount-identity-spy")

    def make_backup_fixture(self, origin: contracts.Document) -> Path:
        self.backup_count += 1
        suffix = str(self.backup_count)
        archive_path = EXTERNAL_ROOT / f"synthetic-full-backup-{suffix}.dump"
        globals_path = EXTERNAL_ROOT / f"synthetic-globals-{suffix}.txt"
        receipt_path = EXTERNAL_ROOT / f"synthetic-full-backup-{suffix}.json"
        archive_path.write_bytes(b"test-only synthetic full PostgreSQL archive fixture\n")
        globals_path.write_bytes(b"test-only protected PostgreSQL globals fixture\n")
        archive_path.chmod(0o400)
        globals_path.chmod(0o400)
        archive_hash = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        globals_hash = hashlib.sha256(globals_path.read_bytes()).hexdigest()
        source_identity = origin["databaseIdentity"]
        restore_identity = {**source_identity,
            "systemIdentifier": str(int(source_identity["systemIdentifier"]) + self.backup_count),
            "databaseOid": str(int(source_identity["databaseOid"]) + 100 + self.backup_count),
            "databaseName": f"isolated_restore_fixture_{self.backup_count}",
            "endpoint": f"isolated-restore-fixture:{self.backup_count}",
            "volume": f"isolated-restore-fixture:{self.backup_count}"}
        completed = contracts.now()
        receipt = {"kind": "labeler-full-postgresql-backup", "version": 1,
            "databaseIdentity": source_identity, "origin": origin,
            "interval": {"startedAt": completed, "completedAt": completed},
            "tools": {"pgDump": "synthetic-fixture", "pgRestore": "synthetic-fixture",
                "serverVersion": source_identity["serverVersion"]},
            "archive": {"format": "custom", "scope": "full-database", "location": str(archive_path),
                "sha256": archive_hash, "encryptionKeyRef": "synthetic-fixture://key-reference",
                "retentionUntil": timestamp_after(365)},
            "prerequisites": {"roles": [], "extensions": [], "tablespaces": [],
                "globals": {"disposition": "protected-globals", "location": str(globals_path), "sha256": globals_hash}},
            "restore": {"databaseIdentity": restore_identity, "completedAt": completed, "result": "verified",
                "schemaFingerprint": origin["schemaFingerprint"], "dataFingerprint": origin["fingerprint"],
                "archiveSha256": archive_hash}, "writersStopped": True}
        write_document(receipt_path, receipt)
        self.backup_proofs.append({"archiveFormat": "custom", "archiveScope": "full-database",
            "restoreResult": "verified", "restoreIsolated": True, "syntheticFixture": True,
            "originSchema": origin["schema"], "originDataBundle": origin["dataBundle"]})
        return receipt_path

    def command(self, arguments: list[str], _payload: bytes | None = None) -> bytes:
        if arguments == [self.environment["LABELER_BACKUP_COMMAND"]]:
            receipt_path = self.make_backup_fixture(self.observe())
            self.events.append("typed-full-backup-restore-fixture")
            return (str(receipt_path) + "\n").encode()
        if "labeling-study-prepare" in arguments:
            self.attach_handoff()
            self.events.append("actual-prepare-wait")
            print("POST_015_PREPARE_READY waiting", flush=True)
            wait_for_signal(signal.SIGWINCH)
            self.probe_path = PREPARED_PROBE_PATH
            self.events.append("actual-prepare-returned")
            return b""
        contracts.require(False, "unexpected command in isolated normalization runtime")
        return b""

    def attach_handoff(self) -> contracts.Document:
        context_path = Path(self.environment["LABELER_RELEASE_CONTEXT_HOST_PATH"])
        if HANDOFF_ROOT.exists():
            shutil.rmtree(HANDOFF_ROOT)
        HANDOFF_ROOT.mkdir(mode=0o700)
        alias = HANDOFF_ROOT / "context.json"
        os.link(context_path, alias, follow_symlinks=False)
        context = contracts.shape(contracts.read(alias),
            "version operationId candidate databaseIdentity phase receipt receiptSha256 observation")
        receipt = contracts.shape(context["receipt"],
            "kind version operationId candidate databaseIdentity phase predecessorEvidence authorization backupRef origin target publication")
        file_stat = alias.stat()
        directory_stat = context_path.parent.stat()
        mount_stat = HANDOFF_ROOT.stat()
        contracts.require(context["phase"] == "pending" and context["candidate"] == receipt["candidate"]
            and context["databaseIdentity"] == receipt["databaseIdentity"]
            and file_stat.st_uid == 0 and file_stat.st_gid == 1000 and file_stat.st_mode & 0o777 == 0o440
            and directory_stat.st_uid == 0 and directory_stat.st_mode & 0o777 == 0o700
            and mount_stat.st_uid == 0 and mount_stat.st_mode & 0o777 == 0o700
            and alias.stat().st_ino == context_path.stat().st_ino, "root handoff binding mismatch")
        attestation = {"operationId": context["operationId"], "candidate": context["candidate"],
            "receiptCandidate": receipt["candidate"], "databaseIdentity": context["databaseIdentity"],
            "receiptDatabaseIdentity": receipt["databaseIdentity"], "observation": context["observation"],
            "fileUid": file_stat.st_uid, "fileGid": file_stat.st_gid, "fileMode": file_stat.st_mode & 0o777,
            "directoryUid": directory_stat.st_uid, "directoryMode": directory_stat.st_mode & 0o777,
            "mountDirectoryUid": mount_stat.st_uid, "mountDirectoryMode": mount_stat.st_mode & 0o777,
            "sameHandoffFile": True, "lockHeld": True}
        match context["receipt"]["authorization"]["action"]:
            case "maintenance-normalize":
                journal, pending = self.state.load()
                write_report({"normalizationProbe": self.normalization_probe(),
                    "reservation": {"phase": pending["phase"], "journalStatus": journal["status"],
                        "generationFloor": self.state.floor(), "candidateGeneration": pending["candidate"]["generation"],
                        "beforeSql": True,
                        "publication": publication.snapshot(self.state.root)},
                    "backupRestoreProofs": [{**proof, "hostBoundaryAccepted": True} for proof in self.backup_proofs]})
                print("HANDOFF_READY " + json.dumps(attestation, separators=(",", ":")), flush=True)
                print("NORMALIZATION_RESERVED_BEFORE_SQL", flush=True)
                wait_for_signal(signal.SIGUSR1)
                self.probe_path = NORMALIZED_PROBE_PATH
                self.events.append("actual-normalizer-cli-returned")
            case "continue":
                print("POST_015_HANDOFF_READY " + json.dumps(attestation, separators=(",", ":")), flush=True)
            case unreachable:
                assert_never(unreachable)
        return attestation

    def normalize(self) -> None:
        self.attach_handoff()
        self.events.append("actual-normalizer-cli-wait")

    def up(self, services: list[str]) -> None:
        self.events.append("runtime-spy:" + ",".join(services))

    def smoke(self) -> None:
        self.events.append("smoke-spy")
