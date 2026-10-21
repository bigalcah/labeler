#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
# --- How to run ---
# 1. Install uv (if not installed):
#      curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run the integration selection from the repository root:
#      node --test --test-concurrency=1 test/host-normalization-handoff.integration.js
# 3. The selection supplies captured PostgreSQL observations to this isolated fixture.

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, "/workspace/test")
sys.path.insert(0, "/workspace/deployment/host")

import contracts
import publication
import recovery
from host_fixture import FakeRuntime, adopted, auth, candidate
from lifecycle import install, pending
from state import State


def main() -> None:
    fixture_root = Path("/fixture")
    root = fixture_root / "host"
    root.mkdir(mode=0o700)
    try:
        inputs = contracts.shape(contracts.read(fixture_root / "observations.json"), "pre015 post015")
        origin = contracts.observation(inputs["pre015"])
        normalized = contracts.observation(inputs["post015"])
        before_publication = publication.snapshot(root)
        state = State(root)
        adopted(state, origin)
        directory, _release, binding = candidate(root)
        install(state, directory, binding)
        receipt = state.reserve(binding, origin, auth("maintenance-normalize"))
        pending(state, receipt)
        runtime = FakeRuntime(root, normalized)
        runtime.applied015 = True
        with patch("authority.authorize", return_value=auth("reconcile")):
            recovery.reconcile(state, runtime)
        journal, checkpoint = state.load()
        print(json.dumps({"phase": checkpoint["phase"], "journalStatus": journal["status"],
            "origin": checkpoint["origin"], "target": checkpoint["target"],
            "generationFloor": state.floor(), "publicationBefore": before_publication,
            "publicationAfter": publication.snapshot(root), "commands": runtime.commands}, separators=(",", ":")))
    finally:
        shutil.rmtree(root)


if __name__ == "__main__":
    main()
