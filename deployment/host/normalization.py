from __future__ import annotations

import authority
import package
import publication
from contracts import Document, SCHEMA, TARGET, require, same_state


def checkpoint(state, receipt: Document, probe: Document) -> Document:
    observed = probe["observation"]
    require(probe["applied015"] is True and probe["eligibility"] == "already-applied"
            and observed["schema"] == SCHEMA and observed["dataBundle"] == receipt["origin"]["dataBundle"]
            and observed["databaseIdentity"] == receipt["databaseIdentity"], "canonical schema and actual 015 commit required")
    require(receipt["phase"] in ("pending", "abandoned", "normalization_verified"), "normalization checkpoint requires pending intent")
    if receipt["phase"] == "normalization_verified":
        require(same_state(receipt["target"]["observation"], observed), "normalized checkpoint drift")
        receipt = state.advance(receipt, "abandoned", "verified")
    successor = {**receipt, "phase": "normalization_verified", "predecessorEvidence": state.load()[0]["evidenceRef"],
                 "target": {"schema": SCHEMA, "dataBundle": observed["dataBundle"], "observation": observed}}
    state.save(successor, "verified")
    return successor


def start(state, runtime, source) -> None:
    from lifecycle import install, pending
    release, binding = package.inspect(source)
    journal, previous = state.load() or (None, None)
    require(previous is not None, "host adoption required")
    retry = previous["phase"] == "abandoned" and previous["authorization"]["action"] == "reconcile" and state.normalization_intent(previous)
    require(retry or (journal["status"] == "verified" and previous["phase"] in ("adoption", "completed")),
            "normalization requires adoption or reauthorized intact origin")
    require((retry and previous["candidate"] == binding and state.floor() == binding["generation"])
            or (not retry and binding["generation"] > state.floor()), "normalization candidate or reservation mismatch")
    authorization = authority.authorize(runtime, "maintenance-normalize", binding, previous["origin"])
    require(authorization["writersStopped"] is True, "normalization requires stopped writers authorization")
    runtime.configure(source, release)
    runtime.verify_images(release)
    runtime.verify_normalization_source()
    probe = runtime.normalization_probe()
    origin = probe["observation"]
    require(origin["databaseIdentity"] == journal["databaseIdentity"] and probe["eligibility"] in ("eligible", "already-applied"),
            "normalization requires complete known source")
    require(not retry or same_state(origin, previous["origin"]), "normalization retry origin changed")
    runtime.writers_stopped()
    backup_ref = authority.backup(runtime, origin)
    require(same_state(runtime.observe(), origin), "origin drift before normalization reservation")
    runtime.unchanged_mounts()
    before = publication.snapshot(state.root)
    destination = install(state, source, binding)
    runtime.configure(destination, release)
    receipt = previous if retry else state.reserve(binding, origin, authorization)
    receipt = {**receipt, "authorization": authorization, "backupRef": backup_ref,
               "publication": {"before": before, "desired": before}}
    receipt = pending(state, receipt)
    fresh = runtime.observe()
    require(same_state(fresh, origin) and fresh["readOnly"]["writersStopped"] is True, "normalization origin changed before handoff")
    runtime.writers_stopped()
    runtime.unchanged_mounts()
    context = state.handoff(receipt, fresh, 1000)
    runtime.environment["LABELER_RELEASE_CONTEXT_HOST_PATH"] = str(context)
    if not probe["applied015"]:
        runtime.normalize()
    checkpoint(state, receipt, runtime.normalization_probe())
    require(publication.snapshot(state.root) == before, "normalization changed publication")


def continue_checkpoint(state, runtime, receipt: Document) -> None:
    from baseline import historical_baseline
    from lifecycle import execute_pending, finish, verified
    probe = runtime.normalization_probe()
    fresh = probe["observation"]
    require(probe["applied015"] and same_state(fresh, receipt["target"]["observation"]), "normalized baseline changed")
    authorization = authority.authorize(runtime, "continue", receipt["candidate"], fresh)
    require(authorization["requestSha256"] != receipt["authorization"]["requestSha256"], "separate fresh continuation authorization required")
    require(publication.snapshot(state.root) == receipt["publication"]["before"], "normalization publication baseline changed")
    backup_ref = None
    if fresh["dataBundle"] != TARGET["dataBundle"]:
        require(authorization["writersStopped"] is True and fresh["readOnly"]["writersStopped"] is True, "continuation writers must remain stopped")
        if fresh["dataBundle"] == "legacy300-v1":
            historical_baseline(state, receipt)
        runtime.writers_stopped()
        backup_ref = authority.backup(runtime, fresh)
    require(same_state(runtime.observe(), fresh), "normalized baseline drift before continuation")
    runtime.unchanged_mounts()
    successor = {**receipt, "phase": "pending", "authorization": authorization,
                 "backupRef": backup_ref, "target": {**TARGET, "observation": None},
                 "predecessorEvidence": state.load()[0]["evidenceRef"]}
    state.save(successor, "pending")
    if fresh["dataBundle"] == TARGET["dataBundle"]:
        finish(state, runtime, verified(state, successor, runtime.observe()))
        return
    execute_pending(state, runtime, successor, "maintenance" if fresh["dataBundle"] == "legacy300-v1" else "deploy")
