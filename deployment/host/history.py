from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import authority
import package
import publication
from contracts import Document, TARGET, require, same_state

if TYPE_CHECKING:
    from runtime import Runtime
    from state import State


def checkpoint(state: State, receipt: Document, probe: Document) -> Document:
    observed = probe["observation"]
    require(probe["applied016"] is True and probe["eligibility"] == "already-applied"
            and observed["schema"] == TARGET["schema"]
            and observed["dataBundle"] == receipt["origin"]["dataBundle"]
            and observed["databaseIdentity"] == receipt["databaseIdentity"], "actual history schema commit required")
    require(receipt["phase"] in ("pending", "abandoned", "history_schema_verified"), "history checkpoint requires pending intent")
    if receipt["phase"] == "history_schema_verified":
        require(same_state(receipt["target"]["observation"], observed), "history checkpoint drift")
        receipt = state.advance(receipt, "abandoned", "verified")
    successor = {**receipt, "phase": "history_schema_verified",
                 "predecessorEvidence": state.load()[0]["evidenceRef"],
                 "target": {"schema": TARGET["schema"], "dataBundle": observed["dataBundle"], "observation": observed}}
    state.save(successor, "verified")
    return successor


def start(state: State, runtime: Runtime, source: Path) -> None:
    from lifecycle import install
    release, binding = package.inspect(source)
    journal, previous = state.load() or (None, None)
    require(previous is not None, "host adoption required")
    normalized = previous["phase"] == "normalization_verified"
    retry = (previous["phase"] == "abandoned" and previous["authorization"]["action"] == "reconcile"
             and state.history_intent(previous))
    require(normalized or retry or (journal["status"] == "verified" and previous["phase"] in ("adoption", "completed")),
            "history requires adoption or an explicitly reconciled origin")
    require((previous["candidate"] == binding and state.floor() == binding["generation"]) if normalized or retry
            else binding["generation"] > state.floor(), "history candidate or reservation mismatch")
    authorization = authority.authorize(runtime, "maintenance-history", binding, previous["origin"])
    require(authorization["writersStopped"] is True, "history requires writer-stop authorization")
    runtime.configure(source, release)
    runtime.verify_images(release)
    probe = runtime.history_probe()
    origin = probe["observation"]
    require(origin["databaseIdentity"] == journal["databaseIdentity"] and probe["eligibility"] in ("eligible", "already-applied"),
            "history requires a known physical source")
    require(not (normalized or retry) or same_state(origin, state.baseline(previous)), "history retry baseline changed")
    if state.has_normalization_checkpoint(previous):
        require(runtime.normalization_probe()["applied015"] is True, "normalization lineage lost")
    before = publication.snapshot(state.root)
    if normalized or retry:
        require(previous["publication"] is None or before == previous["publication"]["before"],
                "history publication baseline changed")
    runtime.writers_stopped()
    backup_ref = authority.backup(runtime, origin)
    require(same_state(runtime.observe(), origin), "history baseline drift before reservation")
    runtime.unchanged_mounts()
    destination = install(state, source, binding)
    runtime.configure(destination, release)
    receipt = previous if normalized or retry else state.reserve(binding, origin, authorization)
    receipt = {**receipt, "phase": "pending", "authorization": authorization, "backupRef": backup_ref,
               "predecessorEvidence": state.load()[0]["evidenceRef"],
               "target": {"schema": TARGET["schema"], "dataBundle": origin["dataBundle"], "observation": None},
               "publication": {"before": before, "desired": before}}
    state.save(receipt, "pending")
    fresh = runtime.observe()
    require(same_state(fresh, origin) and fresh["readOnly"]["writersStopped"] is True, "history baseline changed before handoff")
    runtime.writers_stopped()
    runtime.unchanged_mounts()
    runtime.environment["LABELER_RELEASE_CONTEXT_HOST_PATH"] = str(state.handoff(receipt, fresh, 1000))
    if not probe["applied016"]:
        runtime.preserve_history()
    checkpoint(state, receipt, runtime.history_probe())
    require(publication.snapshot(state.root) == before, "history maintenance changed publication")


def continue_checkpoint(state: State, runtime: Runtime, receipt: Document) -> None:
    from baseline import historical_baseline
    from lifecycle import execute_pending, finish, verified
    fresh = runtime.history_probe()
    observed = fresh["observation"]
    require(fresh["applied016"] is True and same_state(observed, receipt["target"]["observation"]), "history baseline changed")
    authorization = authority.authorize(runtime, "continue", receipt["candidate"], observed)
    require(authorization["requestSha256"] != receipt["authorization"]["requestSha256"], "fresh continuation authorization required")
    require(publication.snapshot(state.root) == receipt["publication"]["before"], "history publication baseline changed")
    backup_ref = None
    if observed["dataBundle"] != TARGET["dataBundle"]:
        require(authorization["writersStopped"] is True and observed["readOnly"]["writersStopped"] is True, "continuation requires stopped writers")
        if observed["dataBundle"] == "legacy300-v1":
            historical_baseline(state, receipt)
        runtime.writers_stopped()
        backup_ref = authority.backup(runtime, observed)
    require(same_state(runtime.observe(), observed), "post-history baseline drift before continuation")
    runtime.unchanged_mounts()
    successor = {**receipt, "phase": "pending", "authorization": authorization, "backupRef": backup_ref,
                 "target": {**TARGET, "observation": None}, "predecessorEvidence": state.load()[0]["evidenceRef"]}
    state.save(successor, "pending")
    if observed["dataBundle"] == TARGET["dataBundle"]:
        finish(state, runtime, verified(state, successor, runtime.observe()))
        return
    execute_pending(state, runtime, successor, "maintenance" if observed["dataBundle"] == "legacy300-v1" else "deploy")
