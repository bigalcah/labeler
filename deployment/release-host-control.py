#!/usr/bin/env python3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "host"))
from control import main
from consumer import fingerprint
from contracts import encoded

if __name__ == "__main__":
    if sys.argv[1:] == ["--version"]:
        print(encoded(fingerprint()).decode())
        sys.exit(0)
    sys.exit(main(local=True))
