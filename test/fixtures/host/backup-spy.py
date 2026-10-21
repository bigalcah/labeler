#!/usr/bin/env python3
import os
import sys
from pathlib import Path

root = Path(os.environ["SPY_ROOT"])
with (root / "commands.log").open("a") as stream:
    stream.write("backup\n")
if os.environ.get("SPY_FAILURE") == "backup":
    sys.exit(1)
print("STUDY_BACKUP_VERIFIED" if os.environ.get("SPY_FAILURE") == "marker" else str(root / "backup.json"))
