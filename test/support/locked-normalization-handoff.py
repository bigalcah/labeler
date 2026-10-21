#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
# --- How to run ---
# 1. Install uv (if not installed):
#      curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run this fixture from the repository root:
#      uv run test/support/locked-normalization-handoff.py
# 3. The deployment harness normally launches it in an isolated Docker container.

from __future__ import annotations

import signal
import shutil
import sys
from pathlib import Path

sys.path.insert(0, "/workspace/test")
sys.path.insert(0, "/workspace/test/support")
sys.path.insert(0, "/workspace/deployment/host")

import contracts
import durable
import normalization
import history
import publication
from host_fixture import adopted, candidate
from lifecycle import continue_operation
from normalization_harness_runtime import (EXTERNAL_ROOT, HANDOFF_ROOT, NORMALIZED_PROBE_PATH,
    STOP_REQUESTED, HarnessRuntime, receive_signal, wait_for_signal, write_authorization, write_report)
from state import State

FIXTURE_ROOT = Path("/fixture")
HOST_ROOT = FIXTURE_ROOT / "host-state"
ORIGIN_PATH = FIXTURE_ROOT / "prepare-origin.json"


def own_normalization() -> None:
    signal.signal(signal.SIGTERM, receive_signal)
    signal.signal(signal.SIGUSR1, receive_signal)
    signal.signal(signal.SIGUSR2, receive_signal)
    signal.signal(signal.SIGWINCH, receive_signal)
    EXTERNAL_ROOT.mkdir(mode=0o700, exist_ok=True)
    (EXTERNAL_ROOT / "full-backup-command").write_text("synthetic harness boundary\n")
    (EXTERNAL_ROOT / "full-backup-command").chmod(0o500)
    origin = contracts.observation(contracts.read(ORIGIN_PATH))
    HOST_ROOT.mkdir(mode=0o700)
    try:
        with durable.lock(HOST_ROOT):
            state = State(HOST_ROOT)
            adopted(state, origin)
            source, _release, binding = candidate(HOST_ROOT)
            runtime = HarnessRuntime(HOST_ROOT, state, binding)
            runtime.environment["LABELER_AUTHORIZATION_FILE"] = str(
                write_authorization("maintenance-normalize", binding, origin["databaseIdentity"]))
            normalization.start(state, runtime, source)
            journal, checkpoint = state.load()
            contracts.require(checkpoint["phase"] == "normalization_verified" and journal["status"] == "verified"
                and state.floor() == binding["generation"] and checkpoint["origin"]["schema"] == "014_copilot_369_cardinality"
                and checkpoint["target"]["schema"] == "study-schema-3"
                and checkpoint["target"]["dataBundle"] == "empty"
                and publication.snapshot(HOST_ROOT) == checkpoint["publication"]["before"],
                "normalization checkpoint did not stop on the verified post-015 baseline")
            initial_request_hash = checkpoint["authorization"]["requestSha256"]
            write_report({"normalizationProbe": contracts.read(NORMALIZED_PROBE_PATH),
                "reservation": {"phase": "normalization_verified", "journalStatus": journal["status"],
                    "generationFloor": state.floor(), "candidateGeneration": binding["generation"], "beforeSql": False,
                    "publication": publication.snapshot(HOST_ROOT)},
                "checkpoint": {"originPreserved": checkpoint["origin"]["schema"] == origin["schema"],
                    "phase": checkpoint["phase"], "stepBaseline": checkpoint["target"]["observation"],
                    "reservationConsumed": False,
                    "publicationUnchanged": True}, "backupRestoreProofs": [{**proof, "hostBoundaryAccepted": True}
                        for proof in runtime.backup_proofs]})
            print("NORMALIZATION_CHECKPOINTED verified", flush=True)
            wait_for_signal(signal.SIGUSR2)
            normalized = runtime.normalization_probe()["observation"]
            runtime.environment["LABELER_AUTHORIZATION_FILE"] = str(
                write_authorization("maintenance-history", binding, normalized["databaseIdentity"]))
            history.start(state, runtime, source)
            history_checkpoint = state.load()[1]
            contracts.require(history_checkpoint["phase"] == "history_schema_verified"
                and history_checkpoint["target"]["observation"]["schema"] == "study-schema-4",
                "history schema must be verified before prepare continuation")
            post_history = runtime.history_probe()["observation"]
            runtime.environment["LABELER_AUTHORIZATION_FILE"] = str(
                write_authorization("continue", binding, post_history["databaseIdentity"]))
            continue_operation(state, runtime, "continue")
            final_journal, final_receipt = state.load()
            fresh_authorization = final_receipt["authorization"]["requestSha256"] != initial_request_hash
            contracts.require(fresh_authorization and final_receipt["phase"] == "completed"
                and final_journal["status"] == "verified", "fresh authorized post-015 continuation did not complete")
            write_report({"normalizationProbe": contracts.read(NORMALIZED_PROBE_PATH),
                "reservation": {"phase": "completed", "journalStatus": final_journal["status"],
                    "generationFloor": state.floor(), "candidateGeneration": binding["generation"],
                    "beforeSql": False,
                    "publication": publication.snapshot(HOST_ROOT)},
                "checkpoint": {"phase": "normalization_verified",
                    "originPreserved": final_receipt["origin"]["schema"] == origin["schema"],
                    "stepBaseline": normalized, "reservationConsumed": False,
                    "publicationUnchanged": True},
                "continuation": {"phase": final_receipt["phase"], "reservationConsumed": True,
                    "freshAuthorization": fresh_authorization,
                    "action": final_receipt["authorization"]["action"],
                    "backupBaselineSchema": runtime.backup_proofs[-1]["originSchema"],
                    "backupBaselineDataBundle": runtime.backup_proofs[-1]["originDataBundle"],
                    "backupRestoreProofs": [{**proof, "hostBoundaryAccepted": True}
                        for proof in runtime.backup_proofs]},
                "historyCheckpoint": {"phase": history_checkpoint["phase"],
                    "stepBaseline": post_history, "publicationUnchanged": True},
                "runtimeSpies": runtime.events})
            print("NORMALIZATION_CONTINUATION_COMPLETE verified", flush=True)
            STOP_REQUESTED.wait()
    finally:
        if HOST_ROOT.exists():
            shutil.rmtree(HOST_ROOT)
        if HANDOFF_ROOT.exists():
            shutil.rmtree(HANDOFF_ROOT)
        if EXTERNAL_ROOT.exists():
            shutil.rmtree(EXTERNAL_ROOT)
        print("HANDOFF_CLEANED", flush=True)


if __name__ == "__main__":
    contracts.require(not sys.argv[1:], "normalization handoff helper accepts no client arguments")
    own_normalization()
