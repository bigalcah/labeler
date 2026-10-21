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
# 3. The selection supplies the current image and isolated PostgreSQL endpoint to this fixture.

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(os.environ["LABELER_REPOSITORY_ROOT"]) / "deployment/host"))

from contracts import Rejected
from runtime import Runtime


def main() -> None:
    runtime = Runtime(Path(os.environ["LABELER_DEPLOY_ROOT"]))
    runtime.compose = ["docker", "compose", "--project-name", os.environ["LABELER_TEST_COMPOSE_PROJECT"],
        "--env-file", os.environ["LABELER_ENV_FILE"], "--file", os.environ["LABELER_TEST_COMPOSE_FILE"]]
    runtime.release = {"images": {"server": os.environ["LABELER_READINESS_TEST_IMAGE"]}}
    commands = []
    run_command = runtime.command

    def capture_command(arguments: list[str], payload: bytes | None = None) -> bytes:
        entrypoint = next((argument for argument in arguments
            if argument in ("scripts/migrate-study-schema.js", "scripts/cutover-copilot-369.js")), "unknown")
        try:
            output = run_command(arguments, payload)
        except Rejected as error:
            commands.append({"entrypoint": entrypoint, "stage": runtime.stage, "error": str(error)})
            raise
        commands.append({"entrypoint": entrypoint, "stage": runtime.stage, "output": output.decode("utf-8")})
        return output

    runtime.command = capture_command
    try:
        runtime.maintenance()
        outcome = {"stage": runtime.stage, "commands": commands, "error": None}
    except Rejected as error:
        outcome = {"stage": runtime.stage, "commands": commands, "error": str(error)}
    print(json.dumps(outcome, separators=(",", ":")))


if __name__ == "__main__":
    main()
