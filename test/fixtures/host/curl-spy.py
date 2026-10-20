#!/usr/bin/env python3
import os
import sys
from pathlib import Path

root = Path(os.environ["SPY_ROOT"])
with (root / "commands.log").open("a") as stream:
    stream.write("curl " + " ".join(sys.argv[1:]) + "\n")
if os.environ.get("SPY_FAILURE") != "smoke":
    sys.stdout.write("200")
sys.exit(1 if os.environ.get("SPY_FAILURE") == "smoke" else 0)
