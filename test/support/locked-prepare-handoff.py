# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
# ─── How to run ───
# python3 -B /workspace/test/support/locked-prepare-handoff.py

from __future__ import annotations

import fcntl
import json
import os
import shutil
import signal
import stat
import sys
import threading
from pathlib import Path
from types import FrameType

sys.path.insert(0, "/workspace/test")
sys.path.insert(0, "/workspace/deployment/host")

import contracts
import durable
import records
from host_fixture import adopted, auth, candidate
from state import State

FIXTURE_ROOT = Path("/fixture")
HOST_ROOT = FIXTURE_ROOT / "host-state"
HANDOFF_ROOT = FIXTURE_ROOT / "host-handoff"
EXTERNAL_ROOT = FIXTURE_ROOT / "external"
ORIGIN_PATH = FIXTURE_ROOT / "prepare-origin.json"
STOP_REQUESTED = threading.Event()


def probe_lock() -> int:
    descriptor = os.open(HOST_ROOT / "locks/deploy.lock", os.O_RDWR | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("LOCK_HELD", flush=True)
            return 0
        print("LOCK_FREE", flush=True)
        return 1
    finally:
        os.close(descriptor)


def clean_stale_state() -> int:
    if HOST_ROOT.exists():
        lock_path = HOST_ROOT / "locks/deploy.lock"
        descriptor = os.open(lock_path, os.O_RDWR | os.O_NOFOLLOW)
        try:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print("LOCK_HELD", flush=True)
                return 1
            shutil.rmtree(HOST_ROOT)
        finally:
            os.close(descriptor)
    if HANDOFF_ROOT.exists():
        shutil.rmtree(HANDOFF_ROOT)
    if EXTERNAL_ROOT.exists():
        shutil.rmtree(EXTERNAL_ROOT)
    print("ROOT_STATE_CLEANED", flush=True)
    return 0


def request_stop(_signal_number: int, _frame: FrameType | None) -> None:
    STOP_REQUESTED.set()


def own_prepare_handoff() -> None:
    signal.signal(signal.SIGTERM, request_stop)
    origin = contracts.observation(contracts.read(ORIGIN_PATH))
    contracts.require(origin["schema"] != "empty" and origin["dataBundle"] == "empty"
                      and origin["readOnly"]["writersStopped"] is True,
                      "handoff requires a verified known empty-prefix readonly origin")
    HOST_ROOT.mkdir(mode=0o700)
    try:
        with durable.lock(HOST_ROOT):
            state = State(HOST_ROOT)
            adopted(state, origin)
            _directory, _release, binding = candidate(HOST_ROOT)
            receipt = state.reserve(binding, origin, auth())
            receipt = state.advance(receipt, "pending")
            context_path = state.handoff(receipt, origin, 1000)
            HANDOFF_ROOT.mkdir(mode=0o700)
            alias = HANDOFF_ROOT / "context.json"
            os.link(context_path, alias, follow_symlinks=False)
            with alias.open("rb") as stream:
                os.fsync(stream.fileno())
            durable.sync_directory(HANDOFF_ROOT)

            context = contracts.shape(contracts.read(alias),
                                      "version operationId candidate databaseIdentity phase receipt receiptSha256 observation")
            context_receipt = records.receipt(context["receipt"])
            file_stat = alias.stat()
            directory_stat = context_path.parent.stat()
            mount_directory_stat = HANDOFF_ROOT.stat()
            contracts.require(context["phase"] == "pending" and context["operationId"] == receipt["operationId"]
                              and context_receipt == receipt and context["candidate"] == receipt["candidate"]
                              and context["databaseIdentity"] == origin["databaseIdentity"]
                              and context_receipt["databaseIdentity"] == origin["databaseIdentity"]
                              and file_stat.st_uid == 0 and file_stat.st_gid == 1000
                              and stat.S_IMODE(file_stat.st_mode) == 0o440
                              and directory_stat.st_uid == 0 and stat.S_IMODE(directory_stat.st_mode) == 0o700
                              and mount_directory_stat.st_uid == 0
                              and stat.S_IMODE(mount_directory_stat.st_mode) == 0o700
                              and alias.stat().st_ino == context_path.stat().st_ino,
                              "root handoff ownership or authority binding mismatch")
            attestation = {
                "operationId": receipt["operationId"],
                "candidate": receipt["candidate"],
                "receiptCandidate": context_receipt["candidate"],
                "databaseIdentity": context["databaseIdentity"],
                "receiptDatabaseIdentity": context_receipt["databaseIdentity"],
                "observation": context["observation"],
                "fileUid": file_stat.st_uid,
                "fileGid": file_stat.st_gid,
                "fileMode": stat.S_IMODE(file_stat.st_mode),
                "directoryUid": directory_stat.st_uid,
                "directoryMode": stat.S_IMODE(directory_stat.st_mode),
                "mountDirectoryUid": mount_directory_stat.st_uid,
                "mountDirectoryMode": stat.S_IMODE(mount_directory_stat.st_mode),
                "sameHandoffFile": alias.stat().st_ino == context_path.stat().st_ino,
                "lockHeld": True,
            }
            print("HANDOFF_READY " + json.dumps(attestation, separators=(",", ":")), flush=True)
            STOP_REQUESTED.wait()
    finally:
        if HOST_ROOT.exists():
            shutil.rmtree(HOST_ROOT)
        if HANDOFF_ROOT.exists():
            shutil.rmtree(HANDOFF_ROOT)
    print("HANDOFF_CLEANED", flush=True)


if __name__ == "__main__":
    if sys.argv[1:] == ["--probe"]:
        sys.exit(probe_lock())
    if sys.argv[1:] == ["--cleanup"]:
        sys.exit(clean_stale_state())
    own_prepare_handoff()
