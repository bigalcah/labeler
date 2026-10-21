import fcntl
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, "/workspace/test")
from host_fixture import adopted, auth, candidate
import contracts
import durable
from state import State

root = Path("/fixture/host")
if sys.argv[1:] == ["--probe"]:
    with (root / "locks/deploy.lock").open("r+") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("LOCK_HELD", flush=True)
            sys.exit(0)
        sys.exit(1)

root.mkdir(mode=0o700)
try:
    with durable.lock(root):
        origin = contracts.observation(contracts.read(Path("/fixture/origin.json")))
        state = State(root)
        adopted(state, origin)
        _, _, binding = candidate(root)
        receipt = state.reserve(binding, origin, auth("maintenance-normalize"))
        receipt = {**receipt, "backupRef": {"path": "/external/verified-backup", "sha256": "f" * 64}}
        from lifecycle import pending
        receipt = pending(state, receipt)
        context = state.handoff(receipt, origin, 1000)
        metadata = context.stat()
        print(json.dumps({"path": str(context.relative_to("/fixture")), "uid": metadata.st_uid,
            "gid": metadata.st_gid, "mode": metadata.st_mode & 0o777,
            "directoryMode": context.parent.stat().st_mode & 0o777}), flush=True)
        sys.stdin.readline()
finally:
    shutil.rmtree(root)
