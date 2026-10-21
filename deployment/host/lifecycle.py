from __future__ import annotations

import os
from pathlib import Path

import authority
import durable
import package
import publication
from contracts import Document, FILES, TARGET, Rejected, require, same_state


def install(state, source: Path, binding: Document) -> Path:
    destination = state.root / "releases" / binding["releaseId"]
    if destination.exists():
        require(package.inspect(destination)[1] == binding, "installed release differs from validated package")
    else:
        durable.directory(destination)
        for name in FILES:
            durable.write(destination / name, (source / name).read_bytes(), immutable=True)
        durable.sync_directory(destination.parent)
    os.chmod(destination / "Caddyfile", 0o444)
    with (destination / "Caddyfile").open("rb") as stream:
        os.fsync(stream.fileno())
    durable.sync_directory(destination)
    return destination


def verified(state, receipt: Document, observed: Document) -> Document:
    require(observed["databaseIdentity"] == receipt["databaseIdentity"]
            and observed["schema"] == TARGET["schema"] and observed["dataBundle"] == TARGET["dataBundle"], "exact target not verified")
    successor = {**receipt, "phase": "cutover_verified", "target": {**TARGET, "observation": observed},
                 "predecessorEvidence": state.load()[0]["evidenceRef"]}
    require(receipt["phase"] in ("pending", "abandoned"), "invalid target transition")
    state.save(successor, "verified")
    return successor


def finish(state, runtime, receipt: Document) -> Document:
    require(receipt["phase"] == "cutover_verified", "runtime requires final release checkpoint, not normalization")
    observed = runtime.observe()
    if state.has_normalization_checkpoint(receipt):
        require(runtime.normalization_probe()["applied015"] is True, "normalized operation lost its 015 lineage")
    require(observed["databaseIdentity"] == receipt["databaseIdentity"] and observed["schema"] == TARGET["schema"]
            and observed["dataBundle"] == TARGET["dataBundle"], "runtime cannot use an unverified target")
    try:
        runtime.up(["labeling-server", "labeling-caddy"])
    except Rejected:
        from recovery import restore_active
        try:
            restore_active(state, runtime, receipt)
        finally:
            runtime.stage = "runtime"
        raise
    receipt = state.advance(receipt, "runtime_verified", "verified")
    try:
        runtime.smoke()
    except Rejected:
        from recovery import restore_active
        try:
            restore_active(state, runtime, receipt)
        finally:
            runtime.stage = "smoke"
        raise
    receipt = state.advance(receipt, "smoke_verified", "verified")
    intent = publication.desired(state.root, receipt["candidate"], state.floor())
    successor = {**receipt, "phase": "publication_intent", "publication": intent,
                 "predecessorEvidence": state.load()[0]["evidenceRef"]}
    state.save(successor, "verified")
    return publication.publish(state, successor)


def deploy(state, runtime, source: Path, action: str) -> None:
    if action == "maintenance-normalize":
        from normalization import start
        start(state, runtime, source)
        return
    release, binding = package.inspect(source)
    loaded = state.load()
    require(loaded is not None, "host adoption required")
    bridge = (loaded[0]["status"] == "verified" and loaded[1]["phase"] == "cutover_verified"
        and (loaded[1]["authorization"]["action"] == "maintenance" or
             (loaded[1]["authorization"]["action"] == "continue" and state.has_normalization_checkpoint(loaded[1])))
        and loaded[1]["origin"]["dataBundle"] == "legacy300-v1" and loaded[1]["candidate"] == binding)
    require(bridge or (loaded[0]["status"] == "verified" and loaded[1]["phase"] in ("adoption", "completed")),
            "interrupted operation requires readonly reconcile and explicit continuation")
    require(bridge or binding["generation"] > state.floor(), "stale generation or replay")
    authorization = authority.authorize(runtime, action, binding, loaded[1]["origin"])
    runtime.configure(source, release)
    runtime.verify_images(release)
    origin = runtime.observe()
    require(origin["schema"] != "014_copilot_369_cardinality", "retired schema requires explicit maintenance normalize")
    require(origin["databaseIdentity"] == loaded[0]["databaseIdentity"], "candidate database identity differs from adopted identity")
    if bridge and origin["dataBundle"] == TARGET["dataBundle"]:
        require(action == "deploy" and state.floor() == binding["generation"]
                and publication.snapshot(state.root) == loaded[1]["publication"]["before"], "DB-ahead maintenance bridge mismatch")
        runtime.configure(state.root / "releases" / binding["releaseId"], release)
        finish(state, runtime, {**loaded[1], "authorization": authorization})
        return
    require(loaded[0]["status"] == "verified" and loaded[1]["phase"] in ("adoption", "completed"), "interrupted operation requires readonly reconcile and explicit continuation")
    require(binding["generation"] > state.floor(), "stale generation or replay")
    require(origin["dataBundle"] != "legacy300-v1" or action == "maintenance", "historical 300 requires manual maintenance; see docs/COPILOT-369-RUNBOOK.md")
    if action == "maintenance":
        require(origin["dataBundle"] == "legacy300-v1", "maintenance requires a verified historical origin")
        require(origin["schema"] in ("013_category_definition_color", "study-schema-3"),
                "historical maintenance requires verified schema through 013; earlier upgrades need separate approval")
        from baseline import historical_baseline
        baseline = historical_baseline(state, loaded[1])
        runtime.writers_stopped()
    backup_ref = None
    if origin["dataBundle"] != TARGET["dataBundle"]:
        require(authorization["writersStopped"] is True, "writer-stop authorization required")
        runtime.writers_stopped()
        backup_ref = authority.backup(runtime, origin)
    require(same_state(runtime.observe(), origin), "origin changed before reservation")
    runtime.unchanged_mounts()
    destination = install(state, source, binding)
    runtime.configure(destination, release)
    receipt = state.reserve(binding, origin, authorization)
    receipt = {**receipt, "backupRef": backup_ref}
    if action == "maintenance":
        receipt = {**receipt, "publication": {"before": baseline, "desired": baseline}}
    receipt = pending(state, receipt)
    execute_pending(state, runtime, receipt, action)


def pending(state, receipt: Document) -> Document:
    predecessor = state.load()
    require(predecessor is not None and predecessor[1]["candidate"] == receipt["candidate"]
            and predecessor[1]["phase"] in ("reserved", "abandoned"), "pending requires exact reserved operation")
    successor = {**receipt, "phase": "pending", "predecessorEvidence": predecessor[0]["evidenceRef"]}
    state.save(successor, "pending")
    return successor


def execute_pending(state, runtime, receipt: Document, action: str) -> None:
    fresh = runtime.observe()
    if state.has_normalization_checkpoint(receipt):
        require(runtime.normalization_probe()["applied015"] is True, "normalized operation lost its 015 lineage")
    require(same_state(fresh, state.baseline(receipt)), "origin drift before mutating handoff")
    context = state.handoff(receipt, fresh, 1000)
    runtime.environment["LABELER_RELEASE_CONTEXT_HOST_PATH"] = str(context)
    if action == "maintenance":
        require(fresh["readOnly"]["writersStopped"] is True, "database writers returned before maintenance")
        runtime.writers_stopped()
        runtime.maintenance()
    else:
        if fresh["dataBundle"] == "empty":
            require(fresh["readOnly"]["writersStopped"] is True, "database writers returned before initialization")
            runtime.up(["labeling-database"])
        runtime.unchanged_mounts()
        runtime.command(runtime.compose + ["run", "--rm", "--no-deps", "labeling-study-prepare"])
    receipt = verified(state, receipt, runtime.observe())
    if action != "maintenance":
        finish(state, runtime, receipt)


def continue_operation(state, runtime, action: str) -> None:
    journal, receipt = state.load() or (None, None)
    require(receipt is not None and receipt["candidate"] is not None and receipt["phase"] in
            ("normalization_verified", "abandoned", "cutover_verified", "publication_intent", "publication_metadata"), "reconcile interrupted operation first")
    require(receipt["phase"] == "normalization_verified" or receipt["authorization"]["action"] == "reconcile", "fresh readonly reconciliation is required before continuation")
    directory = state.root / "releases" / receipt["candidate"]["releaseId"]
    release, binding = package.inspect(directory)
    require(binding == receipt["candidate"] and (state.floor() == binding["generation"]
            or (str(receipt["operationId"]).startswith("rollback-") and state.floor() > binding["generation"])), "continuation candidate or floor mismatch")
    runtime.configure(directory, release)
    runtime.verify_images(release)
    if receipt["phase"] == "normalization_verified":
        from normalization import continue_checkpoint
        require(action == "continue", "explicit continuation required after normalization")
        continue_checkpoint(state, runtime, receipt)
        return
    require(not state.normalization_intent(receipt), "intact normalization origin needs fresh maintenance-normalize authorization")
    fresh = runtime.observe()
    if state.has_normalization_checkpoint(receipt):
        require(runtime.normalization_probe()["applied015"] is True, "normalized operation lost its 015 lineage")
    authorization = authority.authorize(runtime, action, binding, fresh)
    require(fresh["databaseIdentity"] == receipt["databaseIdentity"], "continuation database mismatch")
    os.chmod(directory / "Caddyfile", 0o444)
    with (directory / "Caddyfile").open("rb") as stream:
        os.fsync(stream.fileno())
    durable.sync_directory(directory)
    receipt = {**receipt, "authorization": authorization}
    if receipt["publication"] is not None and receipt["publication"]["desired"]["current"] == "releases/" + binding["releaseId"]:
        require(action == "finalize-publication" and fresh["dataBundle"] == TARGET["dataBundle"], "explicit publication finalization required")
        publication.prefix(state.root, receipt["publication"])
        runtime.check_runtime()
        runtime.smoke()
        if receipt["phase"] == "publication_metadata":
            require(publication.prefix(state.root, receipt["publication"]) == 4, "publication metadata incomplete")
            state.advance(receipt, "completed", "verified")
        else:
            if receipt["phase"] == "abandoned":
                receipt = {**receipt, "phase": "publication_intent", "predecessorEvidence": journal["evidenceRef"]}
            state.save(receipt, "verified")
            publication.publish(state, receipt)
    elif fresh["schema"] == TARGET["schema"] and fresh["dataBundle"] == TARGET["dataBundle"]:
        require(action == "continue", "explicit continuation required")
        if receipt["phase"] == "abandoned":
            receipt = verified(state, receipt, fresh)
        finish(state, runtime, receipt)
    else:
        require(action == "continue" and same_state(fresh, state.baseline(receipt))
                and receipt["phase"] == "abandoned" and authorization["writersStopped"] is True, "only proven intact origin may be reauthorized")
        runtime.writers_stopped()
        receipt = {**receipt, "backupRef": authority.backup(runtime, fresh)}
        receipt = pending(state, receipt)
        execute_pending(state, runtime, receipt, "maintenance" if fresh["dataBundle"] == "legacy300-v1" else "deploy")
