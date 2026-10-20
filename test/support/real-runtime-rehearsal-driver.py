# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Run with the Node rehearsal broker, never with a Docker socket mount."""
from __future__ import annotations

import json
import os
import runpy
import shutil
import sys
from pathlib import Path
from typing import Final

WORKSPACE: Final = Path("/workspace")
sys.path.insert(0, str(WORKSPACE / "deployment/host"))
sys.path.insert(0, str(WORKSPACE / "test"))

import authority
import consumer
import contracts
import durable
import lifecycle
import package
import publication
import recovery
from host_fixture import historical, release
from state import State

transport = runpy.run_path(str(WORKSPACE / "test/support/real-runtime-rehearsal_runtime.py"))
BrokerRuntime = transport["BrokerRuntime"]
exchange = transport["exchange"]


def authorize(runtime: BrokerRuntime, action: str, binding: contracts.Document | None,
              origin: contracts.Document) -> None:
    path = Path(runtime.environment["LABELER_AUTHORIZATION_FILE"])
    drain = {"pushesExcluded": True, "rerunsBlocked": True, "ciTerminal": True,
             "queued": [], "running": [], "awaitingApproval": [], "retryable": [], "inFlight": []} if action == "adopt" else None
    value = {"version": 1, "action": action, "actor": "LOCAL-SYNTHETIC-ATTESTATION-NOT-GITHUB-ENFORCEMENT",
             "issuedAt": "2020-01-01T00:00:00Z", "expiresAt": "2099-01-01T00:00:00Z", "candidate": binding,
             "databaseIdentity": origin["databaseIdentity"], "writersStopped": True, "drain": drain,
             "consumerSha256": consumer.fingerprint()["sha256"]}
    path.write_text(json.dumps(value))
    path.chmod(0o400)


def candidate(directory: Path, generation: int) -> tuple[Path, contracts.Document]:
    source = directory / f"host-candidate-{generation}"
    source.mkdir(mode=0o700)
    (source / "release-manifest.json").write_text(json.dumps(release(generation)))
    shutil.copyfile(directory / "compose.json", source / "docker-compose.yml")
    shutil.copyfile(directory / "Caddyfile", source / "Caddyfile")
    return source, package.inspect(source)[1]


def main() -> None:
    directory = Path(sys.argv[1])
    mode = sys.argv[2]
    root = directory / "host-state"
    root.mkdir(mode=0o700, exist_ok=True)
    for name in ("database-password", "inspection-password", "session-current", "session-previous"):
        path = directory / name
        os.chown(path, 1000, 1000)
        path.chmod(0o400)
    external = directory / "host-external"
    external.mkdir(mode=0o700, exist_ok=True)
    backup = external / "backup-fails"
    backup.write_text("#!/bin/sh\nexit 23\n")
    backup.chmod(0o500)
    os.environ.update({"LABELER_ENV_FILE": str(directory / "production.env"),
        "LABELER_PUBLIC_BASE_URL": "https://localhost", "LABELER_DATABASE_NAME": "rehearsal",
        "LABELER_READONLY_USER": "labeler_inspection", "LABELER_READONLY_PASSWORD_FILE": str(directory / "inspection-password"),
        "LABELER_AUTHORIZATION_FILE": str(external / "authorization.json"), "LABELER_BACKUP_COMMAND": str(backup)})
    with durable.lock(root):
        state = State(root)
        runtime = BrokerRuntime(root)
        source, binding = candidate(directory, 1) if not (directory / "host-candidate-1").exists() else (
            directory / "host-candidate-1", package.inspect(directory / "host-candidate-1")[1])
        runtime.configure(source, release(1))
        if state.load() is None:
            if mode in ("runtime", "smoke", "adoption"):
                baseline = root / "releases" / historical()["releaseId"]
                baseline.mkdir(mode=0o700)
                (baseline / "release-manifest.json").write_text(json.dumps(historical()))
                durable.link(root, "current", "releases/" + baseline.name)
                durable.link(root, "previous", "releases/" + baseline.name)
            origin = runtime.observe()
            authorize(runtime, "adopt", None, origin)
            recovery.adopt(state, runtime)
        origin = state.load()[1]["origin"]
        before = publication.snapshot(root)
        report: contracts.Document = {"mode": mode, "publicationBefore": before,
            "origin": origin, "manifestIdentityIsSynthetic": True, "remoteDrainIsFixture": True}
        match mode:
            case "adoption":
                report["inventory"] = recovery.inventory(state, runtime)
            case "reconcile":
                authorize(runtime, "reconcile", binding, origin)
                recovery.reconcile(state, runtime)
            case "interrupt-origin" | "interrupt-target" | "unknown":
                authorize(runtime, "deploy", binding, origin)
                lifecycle.install(state, source, binding)
                receipt = state.reserve(binding, origin, authority.authorize(runtime, "deploy", binding, origin))
                lifecycle.pending(state, receipt)
                exchange("checkpoint")
                raise contracts.Rejected("checkpoint must terminate owning process")
            case "backup" | "runtime" | "smoke" | "rollback":
                authorize(runtime, "deploy", binding, origin)
                result = "FAILED"
                try:
                    lifecycle.deploy(state, runtime, source, "deploy")
                    contracts.require(mode == "rollback", "injected failure was not observed")
                    source2, binding2 = candidate(directory, 2)
                    authorize(runtime, "deploy", binding2, origin)
                    lifecycle.deploy(state, runtime, source2, "deploy")
                    before = publication.snapshot(root)
                    report["publicationBefore"] = before
                    exchange("fault")
                    authorize(runtime, "rollback", binding, origin)
                    recovery.rollback(state, runtime)
                    result = "SUCCEEDED"
                except contracts.Rejected as error:
                    report["failure"] = str(error)
                    report["failureStage"] = runtime.stage
                report["result"] = result
                report["failedJournal"], failed = state.load()
                report["failedPhase"] = failed["phase"]
                if mode != "backup":
                    authorize(runtime, "reconcile", failed["candidate"], origin)
                    recovery.reconcile(state, runtime)
            case _:
                raise contracts.Rejected("unknown rehearsal mode")
        report["journal"], receipt = state.load()
        report["phase"] = receipt["phase"]
        report["publicationAfter"] = publication.snapshot(root)
        report["floor"] = state.floor()
        report["fresh"] = runtime.observe() if mode != "reconcile" or report["journal"]["status"] != "unknown" else None
        output = directory / "host-output/report.json"
        output.write_text(json.dumps(report))
        output.chmod(0o444)
        print(json.dumps({"report": True}), flush=True)


if __name__ == "__main__":
    main()
