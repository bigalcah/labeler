#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

root = Path(os.environ["SPY_ROOT"])
arguments = sys.argv[1:]
with (root / "commands.log").open("a") as stream:
    stream.write("docker " + " ".join(arguments) + "\n")
failure = os.environ.get("SPY_FAILURE", "")
if arguments[:1] == ["compose"] and "config" in arguments:
    if failure == "config":
        sys.exit(1)
    if os.environ.get("SPY_WARNING"):
        print("WARNING: version is obsolete", file=sys.stderr)
    config = json.loads((root / "compose.json").read_text())
    for name, service in config["services"].items():
        if name == "labeling-database":
            service["image"] = os.environ["LABELER_DATABASE_IMAGE"]
        elif name != "labeling-caddy":
            service["image"] = os.environ["LABELER_SERVER_IMAGE"]
        for mount in service.get("volumes", []):
            if mount.get("target") == "/run/labeler-release/context.json":
                mount["source"] = os.environ["LABELER_RELEASE_CONTEXT_HOST_PATH"]
            if mount.get("target") == "/etc/caddy/Caddyfile":
                mount["source"] = str(Path(arguments[arguments.index("-f") + 1]).parent / "Caddyfile")
    print(json.dumps(config))
elif arguments[:2] == ["image", "inspect"]:
    image = arguments[-1]
    commit = image.split(":sha-")[1].split("@")[0]
    print(json.dumps([{"RepoDigests": [] if failure == "digest" else [image.split(":sha-")[0] + "@" + image.split("@")[1]],
        "Config": {"User": "node", "Labels": {"org.opencontainers.image.revision": "0" * 40 if failure == "revision" else commit}}}]))
elif arguments[:1] == ["inspect"]:
    if arguments[-1] == "fixture-running-v1" and (root / "inventory.json").exists():
        print((root / "inventory.json").read_text())
    else:
        print((root / "database.json").read_text())
elif arguments[:1] == ["ps"]:
    if "-a" in arguments and (root / "inventory.json").exists():
        print("fixture-running-v1")
elif "sha256sum" in arguments:
    for index, (name, checksum) in enumerate(json.loads((root / "artifacts.json").read_text())):
        print(("0" * 64 if failure == f"hash-{index}" else checksum) + "  " + name)
elif "id" in arguments:
    print("1000")
elif "scripts/study-readiness.js" in arguments:
    value = json.loads((root / "observation.json").read_text())
    value["databaseIdentity"].pop("volume")
    value["databaseIdentity"].pop("endpoint")
    applied = (root / "applied015").exists()
    print(json.dumps({"observation": value, "applied015": applied,
        "eligibility": "already-applied" if applied else "eligible"} if "--normalization-probe" in arguments else value))
elif "--input-type=module" in arguments and "readNormalizationSource" in arguments[-1]:
    print("0" * 64 if failure == "normalization-source" else "53f8188e453101b9a06f16e1b2891c7538aecaed8e83b954d00cf3e6a4dbf951", end="")
elif "scripts/normalize-retired-study-schema.js" in arguments:
    if failure == "normalization":
        sys.exit(1)
    context = Path(os.environ["LABELER_RELEASE_CONTEXT_HOST_PATH"])
    value = json.loads(context.read_text())
    if value["receipt"]["authorization"]["action"] != "maintenance-normalize" or value["receipt"]["phase"] != "pending":
        sys.exit(3)
    origin = json.loads((root / "observation.json").read_text())
    origin.update(schema="study-schema-3", schemaFingerprint="a" * 64,
        fingerprint=__import__("hashlib").sha256((origin["dataBundle"] + "015").encode()).hexdigest())
    (root / "observation.json").write_text(json.dumps(origin))
    (root / "applied015").touch()
    if failure == "post-commit":
        sys.exit(1)
elif "labeling-study-prepare" in arguments and "run" in arguments:
    if failure == "prepare":
        sys.exit(1)
    context = Path(os.environ["LABELER_RELEASE_CONTEXT_HOST_PATH"])
    if not context.is_file() or context.stat().st_uid != 0 or context.stat().st_gid != 1000 or context.stat().st_mode & 0o777 != 0o440:
        sys.exit(2)
    value = json.loads(context.read_text())
    if value["receipt"]["phase"] != "pending":
        sys.exit(3)
    (root / "observation.json").write_bytes((root / "target.json").read_bytes())
elif "labeling-server" in arguments and "up" in arguments:
    if failure == "runtime":
        sys.exit(1)
