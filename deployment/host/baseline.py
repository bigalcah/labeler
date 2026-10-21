from __future__ import annotations

import hashlib

import publication
from contracts import Document, read, require, shape
from manifest import historical


def historical_baseline(state, receipt: Document) -> Document:
    baseline = publication.snapshot(state.root)
    adoption = receipt
    for prior in state.predecessors(receipt):
        adoption = prior
    if adoption["phase"] != "adoption":
        adoption = read(state.root / adoption["predecessorEvidence"])
    require(adoption["phase"] == "adoption" and baseline == adoption["publication"]["desired"],
            "historical baseline changed after adoption")
    inventory_path = state.root / "evidence/adoption" / (adoption["operationId"] + "-inventory.json")
    require(inventory_path.stat().st_uid == 0 and inventory_path.stat().st_mode & 0o777 == 0o440, "trusted adoption inventory required")
    inventory = shape(read(inventory_path), "consumer releases publication runtime")
    require(inventory["publication"] == baseline, "adoption baseline inventory mismatch")
    history = {item["releaseId"]: item for item in inventory["releases"]}
    for pointer in ("current", "previous"):
        require(baseline[pointer] is not None, "maintenance requires both recorded v1 baseline pointers")
        path = state.root / baseline[pointer] / "release-manifest.json"
        require(historical(read(path))["schemaVersion"] == 1, "maintenance requires both recorded v1 baseline pointers")
        require(path.parent.name in history and hashlib.sha256(path.read_bytes()).hexdigest() == history[path.parent.name]["manifestSha256"],
                "historical baseline manifest changed after adoption")
    return baseline
