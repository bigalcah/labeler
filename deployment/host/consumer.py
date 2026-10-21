import hashlib
import os
from pathlib import Path

from contracts import Document, encoded, require


def fingerprint(observer_root: Path | None = None) -> Document:
    deployment = Path(__file__).resolve().parent.parent
    paths = sorted((deployment / "host").glob("*.py")) + [deployment / "deploy-vps.sh", deployment / "release-host-control.py"]
    files = {}
    for path in paths:
        require(path.is_file() and not path.is_symlink(), "unsafe installed consumer file")
        files[str(path.relative_to(deployment))] = hashlib.sha256(path.read_bytes()).hexdigest()
    configured = observer_root or (Path(os.environ["LABELER_OBSERVER_ASSETS_ROOT"]) if os.environ.get("LABELER_OBSERVER_ASSETS_ROOT") else None)
    if configured is not None:
        require(configured.is_absolute() and configured.is_dir() and not configured.is_symlink()
                and configured.stat().st_uid == 0 and configured.stat().st_mode & 0o022 == 0, "trusted observer asset root required")
        for path in sorted(configured.rglob("*")):
            require(not path.is_symlink() and path.stat().st_uid == 0 and path.stat().st_mode & 0o022 == 0, "observer assets must be root-owned and readonly to clients")
            if path.is_file():
                relative = path.relative_to(configured)
                require(relative.parts[0] in ("util", "scripts", "schema", "data")
                        and path.suffix in (".js", ".sh", ".json", ".sql", ".csv"), "unexpected observer asset")
                if relative.parts[0] == "data":
                    require(len(relative.parts) == 2 and path.name in ("pr-cards.csv", "copilot-369-cards.csv",
                        "copilot-369-cards.manifest.json", "validation-30-cards.csv", "validation-30-cards.manifest.json"), "unexpected observer data file")
                files["observer/" + str(relative)] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"version": 2, "files": files, "sha256": hashlib.sha256(encoded(files)).hexdigest()}
