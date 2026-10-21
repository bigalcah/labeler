from __future__ import annotations

import hashlib
import uuid

import authority
import durable
import manifest
import package
import publication
from consumer import fingerprint
from contracts import Document, TARGET, encoded, now, read, require, same_state
from lifecycle import finish, verified


def restore_active(state, runtime, receipt: Document) -> bool:
    from contracts import Rejected
    try:
        current = publication.snapshot(state.root)["current"]
        if current is None:
            return False
        directory = state.root / current
        value = manifest.historical(read(directory / "release-manifest.json"))
        if value["schemaVersion"] != 2:
            return False
        release, _binding = package.inspect(directory)
        runtime.configure(directory, release)
        runtime.verify_images(release)
        observed = runtime.observe()
        require(observed["databaseIdentity"] == receipt["databaseIdentity"] and observed["schema"] == TARGET["schema"]
                and observed["dataBundle"] == TARGET["dataBundle"], "actual database is not rollback compatible")
        runtime.up(["labeling-server", "labeling-caddy"])
        runtime.smoke()
        return True
    except Rejected:
        return False


def inventory(state, runtime) -> Document:
    history = []
    for directory in sorted((state.root / "releases").iterdir()):
        require(directory.is_dir() and not directory.is_symlink(), "unsafe historical release")
        path = directory / "release-manifest.json"
        value = manifest.historical(read(path))
        require(value["releaseId"] == directory.name, "historical directory identity mismatch")
        history.append({"releaseId": value["releaseId"], "schemaVersion": value["schemaVersion"],
                        "manifestSha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    pointers = publication.snapshot(state.root)
    for name in ("current", "previous"):
        if pointers[name] is not None:
            require((state.root / pointers[name] / "release-manifest.json").is_file(), "historical pointer target is missing")
    return {"consumer": fingerprint(), "releases": history, "publication": pointers, "runtime": runtime.inventory()}


def adopt(state, runtime) -> None:
    require(state.load() is None, "host already adopted")
    observed = runtime.observe()
    authorization = authority.authorize(runtime, "adopt", None, observed)
    host_inventory = inventory(state, runtime)
    require(all(item["schemaVersion"] == 1 for item in host_inventory["releases"]),
            "missing v2 journal cannot be replaced by a new adoption")
    operation = f"adoption-{uuid.uuid4()}"
    root = state.root / "evidence/adoption"
    durable.directory(root)
    durable.document(root / f"{operation}-inventory.json", host_inventory, immutable=True)
    receipt = {"kind": "labeler-host-operation", "version": 1, "operationId": operation,
        "candidate": None, "databaseIdentity": observed["databaseIdentity"], "phase": "adoption",
        "predecessorEvidence": None, "authorization": authorization, "backupRef": None,
        "origin": observed, "target": {**TARGET, "observation": observed if observed["schema"] == TARGET["schema"] and observed["dataBundle"] == TARGET["dataBundle"] else None},
        "publication": {"before": host_inventory["publication"], "desired": host_inventory["publication"]}}
    state.save(receipt, "verified")


def reconcile(state, runtime) -> None:
    journal, receipt = state.load() or (None, None)
    require(receipt is not None, "no adopted state to reconcile")
    if receipt["candidate"] is not None:
        directory = state.root / "releases" / receipt["candidate"]["releaseId"]
        release, binding = package.inspect(directory)
        require(binding == receipt["candidate"], "reconcile installed candidate mismatch")
        runtime.configure(directory, release)
    authorization = authority.authorize(runtime, "reconcile", receipt["candidate"], receipt["origin"])
    from contracts import Rejected
    try:
        normalization = state.normalization_intent(receipt)
        history = state.history_intent(receipt)
        probe = runtime.history_probe() if history else runtime.normalization_probe() if normalization else None
        fresh = probe["observation"] if probe is not None else runtime.observe()
        if state.has_normalization_checkpoint(receipt):
            require(runtime.normalization_probe()["applied015"] is True, "normalized operation lost its 015 lineage")
    except Rejected:
        state.advance({**receipt, "authorization": authorization}, "unknown", "unknown")
        return
    containers = runtime.inventory()
    require(not any(item["running"] and "study-prepare" in item["name"] for item in containers),
            "preparation still owns an in-flight container; reconciliation cannot authorize continuation")
    receipt = {**receipt, "authorization": authorization}
    if fresh["databaseIdentity"] != receipt["databaseIdentity"]:
        state.advance(receipt, "unknown", "unknown")
        require(False, "reconcile database identity mismatch")
    if receipt["phase"] == "completed":
        require(publication.snapshot(state.root) == receipt["publication"]["desired"]
                and state.floor() >= receipt["candidate"]["generation"], "completion metadata conflict")
        if fresh["schema"] != TARGET["schema"] or fresh["dataBundle"] != TARGET["dataBundle"]:
            state.advance(receipt, "unknown", "unknown")
            require(False, "completed database no longer matches")
        return
    require(receipt["phase"] not in ("unknown", "adoption"), "unknown or adoption is not a continuation")
    if receipt["publication"] is not None:
        publication.prefix(state.root, receipt["publication"])
    if state.floor() < receipt["candidate"]["generation"]:
        require(receipt["phase"] == "reserved", "floor missing without surviving VALIDATED reservation")
        durable.write(state.root / "state/highest-generation", f"{receipt['candidate']['generation']}\n".encode())
    require(state.floor() == receipt["candidate"]["generation"]
            or (str(receipt["operationId"]).startswith("rollback-") and state.floor() > receipt["candidate"]["generation"]),
             "reservation floor conflict")
    if history:
        from history import checkpoint
        if receipt["phase"] == "reserved" and same_state(fresh, state.baseline(receipt)):
            state.advance(receipt, "abandoned", "pending")
        elif probe["applied016"] and fresh["schema"] == TARGET["schema"] and fresh["dataBundle"] == receipt["origin"]["dataBundle"]:
            checkpoint(state, receipt, probe)
        elif same_state(fresh, state.baseline(receipt)) and receipt["phase"] != "history_schema_verified":
            state.advance(receipt, "abandoned", "pending")
        else:
            state.advance(receipt, "unknown", "unknown")
        return
    if normalization:
        from normalization import checkpoint
        if receipt["phase"] == "reserved" and same_state(fresh, receipt["origin"]):
            state.advance(receipt, "abandoned", "pending")
        elif probe["applied015"] and fresh["schema"] == "study-schema-3" and fresh["dataBundle"] == receipt["origin"]["dataBundle"]:
            checkpoint(state, receipt, probe)
        elif same_state(fresh, receipt["origin"]) and receipt["phase"] != "normalization_verified":
            state.advance(receipt, "abandoned", "pending")
        else:
            state.advance(receipt, "unknown", "unknown")
        return
    if fresh["schema"] == TARGET["schema"] and fresh["dataBundle"] == TARGET["dataBundle"]:
        if receipt["phase"] in ("pending", "abandoned"):
            verified(state, receipt, fresh)
        elif receipt["phase"] not in ("cutover_verified", "publication_intent", "publication_metadata"):
            state.advance(receipt, "abandoned", "pending")
        else:
            successor = {**receipt, "phase": "abandoned", "predecessorEvidence": journal["evidenceRef"],
                         "target": {**TARGET, "observation": fresh}}
            state.save(successor, "verified")
    elif same_state(fresh, state.baseline(receipt)):
        state.advance(receipt, "abandoned", "pending")
    else:
        state.advance(receipt, "unknown", "unknown")


def rollback(state, runtime) -> None:
    journal, receipt = state.load() or (None, None)
    require(journal is not None and journal["status"] == "verified" and receipt["phase"] == "completed", "verified coherent state required for rollback")
    require(publication.snapshot(state.root) == receipt["publication"]["desired"], "publication conflict blocks rollback")
    previous = publication.snapshot(state.root)["previous"]
    require(previous is not None, "previous release required")
    directory = state.root / previous
    value = manifest.historical(read(directory / "release-manifest.json"))
    require(value["schemaVersion"] == 2 and value["schemaCompatibility"]["applicationSupports"] == [TARGET["schema"]]
            and value["dataCompatibility"]["applicationSupports"] == [TARGET["dataBundle"]], "previous application lacks both compatibility axes")
    release, binding = package.inspect(directory)
    runtime.configure(directory, release)
    runtime.verify_images(release)
    observed = runtime.observe()
    require(observed["databaseIdentity"] == journal["databaseIdentity"] and observed["schema"] == TARGET["schema"]
            and observed["dataBundle"] == TARGET["dataBundle"], "actual database does not match rollback axes")
    authorization = authority.authorize(runtime, "rollback", binding, observed)
    successor = {**receipt, "operationId": f"rollback-{uuid.uuid4()}", "candidate": binding, "phase": "reserved",
        "origin": observed, "authorization": authorization, "predecessorEvidence": journal["evidenceRef"],
        "publication": None, "target": {**TARGET, "observation": observed}}
    state.save(successor, "pending")
    successor = state.advance(successor, "pending")
    successor = verified(state, successor, runtime.observe())
    finish(state, runtime, successor)
