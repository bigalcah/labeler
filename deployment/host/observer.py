from __future__ import annotations

import hashlib
import re
from pathlib import Path

import manifest
from contracts import Document, IMAGE, decode, observation, read, require, shape


def probe(runtime, *, history: bool = False) -> Document:
    from runtime import TARGETS
    runtime.stage = "database-inspection"
    image = runtime.release.get("images", {}).get("server") or runtime.environment.get("LABELER_OBSERVER_IMAGE", "")
    require(re.fullmatch(IMAGE, image) is not None, "digest-bound observer image required")
    database = decode(runtime.command(["docker", "inspect", "labeling-database"]))[0]
    require(database["State"].get("Health", {}).get("Status") == "healthy", "existing provisioned database must be healthy")
    volumes = [mount for mount in database["Mounts"] if mount["Destination"] == "/var/lib/postgresql/data"]
    require(len(volumes) == 1 and volumes[0].get("Name") == "labeling-data", "database host volume mismatch")
    password = runtime.external(runtime.environment.get("LABELER_READONLY_PASSWORD_FILE", ""))
    arguments = ["docker", "run", "--rm", "--network", "labeling-network", "--read-only", "--cap-drop", "ALL",
                 "--mount", f"type=bind,src={password},dst=/run/secrets/inspection-password,readonly"]
    settings = {"DATABASE_HOST": "labeling-database", "DATABASE_PORT": "5432", "DATABASE_NAME": runtime.environment["LABELER_DATABASE_NAME"],
                "DATABASE_USER": runtime.environment["LABELER_READONLY_USER"], "DATABASE_PASS_FILE": "/run/secrets/inspection-password", "LABELER_READINESS_STRICT": "true"}
    if runtime.config:
        prepare = runtime.config["services"]["labeling-study-prepare"]
        for mount in prepare["volumes"]:
            if mount["target"] in TARGETS - {"/run/secrets/database-password"}:
                arguments += ["--mount", f"type=bind,src={mount['source']},dst={mount['target']},readonly"]
    else:
        assets = Path(runtime.environment.get("LABELER_OBSERVER_ASSETS_ROOT", ""))
        require(assets.is_absolute() and not assets.resolve().is_relative_to(runtime.root.resolve()), "adoption requires separately installed observer assets")
        from consumer import fingerprint
        fingerprint(assets)
        for name in ("util", "scripts", "schema", "data"):
            require((assets / name).is_dir() and not (assets / name).is_symlink(), "observer asset subtree is missing")
            arguments += ["--mount", f"type=bind,src={assets / name},dst=/labeling/{name},readonly"]
        for filename, checksum in manifest.ARTIFACTS:
            source = assets / "data" / Path(filename).name
            require(source.is_file() and hashlib.sha256(source.read_bytes()).hexdigest() == checksum, "observer data identity mismatch")
        mounts_file = runtime.external(runtime.environment.get("LABELER_OBSERVER_MOUNTS_FILE", ""))
        mounts = read(mounts_file)
        require(set(mounts) == TARGETS - {"/run/secrets/database-password"}, "adoption observer requires exact external profile mounts")
        for target, source in mounts.items():
            source = runtime.external(source)
            arguments += ["--mount", f"type=bind,src={source},dst={target},readonly"]
    settings["STUDY_PROFILES_INPUT"] = "/run/config/study-profiles.json"
    for key, value in settings.items():
        arguments += ["-e", f"{key}={value}"]
    lineage = "applied016" if history else "applied015"
    result = shape(decode(runtime.command(arguments + ["--entrypoint", "node", image,
        "scripts/study-readiness.js", "--history-probe" if history else "--normalization-probe"])), f"observation {lineage} eligibility")
    require(type(result[lineage]) is bool and result["eligibility"] in
            ("eligible", "already-applied", "ineligible"), "invalid maintenance probe")
    require((result["eligibility"] == "already-applied") == result[lineage], "inconsistent migration evidence")
    value = result["observation"]
    shape(value["databaseIdentity"], "systemIdentifier databaseOid databaseName serverVersion")
    value["databaseIdentity"].update({"endpoint": f"labeling-database:5432/{settings['DATABASE_NAME']}",
                                       "volume": volumes[0]["Name"] + ":" + volumes[0]["Source"]})
    result["observation"] = observation(value)
    require(not result[lineage] or value["schema"] in (("study-schema-4",) if history else ("study-schema-3", "study-schema-4")),
            "migration lineage requires canonical physical schema")
    return result
