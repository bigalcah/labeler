from __future__ import annotations

import os
import re
import shutil
import sys
import tarfile
import uuid
from pathlib import Path

import durable
import lifecycle
import package
import recovery
from contracts import Action, RELEASE, Rejected, assert_never, now, require
from runtime import Runtime
from state import State


def request(arguments: list[str], local: bool) -> tuple[Action, str | None]:
    original = os.environ.get("SSH_ORIGINAL_COMMAND")
    if original is not None:
        require(not local and not arguments, "forced SSH does not accept direct arguments")
        if original == "rollback":
            return "rollback", None
        matched = re.fullmatch("deploy (" + RELEASE + ")", original)
        require(matched is not None, "SSH_ORIGINAL_COMMAND is not authorized")
        return "deploy", matched[1]
    allowed = {"adopt", "reconcile", "maintenance", "continue", "finalize-publication"} if local else {"deploy", "rollback"}
    require(bool(arguments) and arguments[0] in allowed, "usage: deploy-vps.sh deploy <release-id> | rollback; local root helper: adopt | reconcile | maintenance [normalize] <release-id> | continue | finalize-publication")
    action = arguments[0]
    if local and action == "maintenance" and len(arguments) == 3 and arguments[1] in ("normalize", "history"):
        require(re.fullmatch(RELEASE, arguments[2]) is not None, "invalid release ID")
        return ("maintenance-normalize" if arguments[1] == "normalize" else "maintenance-history"), arguments[2]
    if action in ("deploy", "maintenance"):
        require(len(arguments) == 2 and re.fullmatch(RELEASE, arguments[1]) is not None, "invalid release ID")
        return ("deploy" if action == "deploy" else "maintenance"), arguments[1]
    require(len(arguments) == 1, "unexpected arguments")
    actions: dict[str, Action] = {"adopt": "adopt", "reconcile": "reconcile", "continue": "continue",
                                 "finalize-publication": "finalize-publication", "rollback": "rollback"}
    return actions[action], None


def main(local: bool = False) -> int:
    os.umask(0o077)
    attempt = None
    runtime = None
    try:
        action, release_id = request(sys.argv[1:], local)
        require(os.geteuid() == 0, "release controller requires local root privileges")
        root = Path(os.environ.get("LABELER_DEPLOY_ROOT", ""))
        require(root.is_absolute() and root.is_dir() and not root.is_symlink()
                and root.stat().st_uid == 0 and root.stat().st_mode & 0o022 == 0, "trusted existing host deployment root required")
        with durable.lock(root):
            state = State(root)
            evidence = root / "evidence" / (release_id or action)
            durable.directory(evidence)
            attempt = evidence / ("attempt-" + now().replace(":", "") + "-" + str(uuid.uuid4()))
            durable.directory(attempt)
            runtime = Runtime(root)
            match action:
                case "deploy" | "maintenance" | "maintenance-normalize" | "maintenance-history":
                    stage = root / "incoming" / str(uuid.uuid4())
                    try:
                        release, _binding = package.receive(sys.stdin.buffer, stage)
                        require(release["releaseId"] == release_id, "release ID does not match manifest")
                        durable.write(attempt / "release-manifest.json", (stage / "release-manifest.json").read_bytes())
                        lifecycle.deploy(state, runtime, stage, action)
                    finally:
                        if stage.exists():
                            shutil.rmtree(stage)
                case "adopt":
                    recovery.adopt(state, runtime)
                case "reconcile":
                    recovery.reconcile(state, runtime)
                case "rollback":
                    recovery.rollback(state, runtime)
                case "continue" | "finalize-publication":
                    lifecycle.continue_operation(state, runtime, action)
                case unreachable:
                    assert_never(unreachable)
            if runtime.summary is not None:
                durable.document(attempt / "compose-config.json", runtime.summary)
                durable.write(attempt / "compose-config.log", runtime.compose_diagnostic)
            durable.write(attempt / "result", b"SUCCEEDED complete\n")
        print("DEPLOY_VPS_SUCCEEDED " + action + (" " + release_id if release_id else ""))
        return 0
    except (Rejected, OSError, KeyError, TypeError, tarfile.TarError, UnicodeError) as error:
        message = str(error) if isinstance(error, Rejected) else "host boundary failure"
        if attempt is not None:
            try:
                if runtime is not None and runtime.summary is not None:
                    durable.document(attempt / "compose-config.json", runtime.summary)
                    durable.write(attempt / "compose-config.log", runtime.compose_diagnostic)
                durable.write(attempt / "diagnostic.log", (message + "\n").encode())
                durable.write(attempt / "result", ("FAILED " + (runtime.stage if runtime is not None else "configuration") + "\n").encode())
            except OSError:
                print("DEPLOY_VPS_DIAGNOSTIC_PERSISTENCE_FAILED", file=sys.stderr)
        print("DEPLOY_VPS_FAILED: " + message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
