"""Root-delegated deployment through the existing restricted SSH ingress."""
from __future__ import annotations

import datetime as dt
import hashlib
import os
import tempfile
import uuid
from contextlib import contextmanager
from pathlib import Path
from collections.abc import Iterator
from typing import TYPE_CHECKING

import durable
import history
import lifecycle
import normalization
import package
import records
import recovery
from consumer import fingerprint
from contracts import Document, TARGET, encoded, now, observation, read, require, same_state, shape

if TYPE_CHECKING:
    from runtime import Runtime
    from state import State


def policy(runtime: Runtime, release: Document) -> Document | None:
    path = runtime.env_file.parent / "automatic-deployment.json"
    if not path.exists():
        return None
    path = runtime.external(str(path))
    require(path.stat().st_uid == 0, "automatic deployment policy must be root-owned")
    value = shape(read(path), "version repository databaseName consumerSha256 backupRequired allowHistoricalCutover legacyIngressDisabled")
    require(type(value["version"]) is int and value["version"] == 1
            and value["backupRequired"] is False and value["allowHistoricalCutover"] is True
            and value["legacyIngressDisabled"] is True, "invalid automatic deployment policy")
    require(value["consumerSha256"] == fingerprint()["sha256"], "automatic deployment consumer approval changed")
    require(value["databaseName"] == runtime.environment["LABELER_DATABASE_NAME"], "automatic deployment DB mismatch")
    repository = value["repository"]
    require(type(repository) is str and repository.count("/") == 1, "automatic deployment repository required")
    for service, image in release["images"].items():
        require(image.startswith(f"ghcr.io/{repository}-{service}:sha-"), "automatic deployment repository mismatch")
    return {"policySha256": hashlib.sha256(path.read_bytes()).hexdigest(), "backupRequired": False}


def authorization(runtime: Runtime, action: str, binding: Document | None, observed: Document) -> Document:
    delegation = shape(runtime.automation, "policySha256 backupRequired")
    issued = now()
    expires = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    request = {"action": action, "candidate": binding, "databaseIdentity": observed["databaseIdentity"],
               "automation": delegation, "issuedAt": issued, "nonce": str(uuid.uuid4())}
    return records.authorization({"action": action, "actor": "root-delegated-master", "issuedAt": issued,
        "expiresAt": expires, "requestSha256": hashlib.sha256(encoded(request)).hexdigest(),
        "writersStopped": True, "drain": None, "automation": delegation})


@contextmanager
def cutover_request(runtime: Runtime, historical: bool) -> Iterator[None]:
    if not historical:
        yield
        return
    runtime.writers_stopped()
    mounts = runtime.config["services"]["labeling-study-prepare"]["volumes"]
    password = next(mount["source"] for mount in mounts if mount["target"] == "/run/secrets/database-password")
    payload = runtime.command(runtime.compose + ["run", "--rm", "--no-deps", "--entrypoint", "node",
        "labeling-study-prepare", "scripts/create-copilot-cutover-request.js", password])
    with tempfile.TemporaryDirectory(prefix="labeler-cutover-") as directory:
        root = Path(directory)
        path = root / "request.json"
        durable.write(path, payload)
        os.chown(path, 0, 1000)
        path.chmod(0o440)
        previous = runtime.environment.get("LABELER_CUTOVER_REQUEST_FILE")
        runtime.environment["LABELER_CUTOVER_REQUEST_FILE"] = str(path)
        try:
            yield
        finally:
            if previous is None:
                runtime.environment.pop("LABELER_CUTOVER_REQUEST_FILE", None)
            else:
                runtime.environment["LABELER_CUTOVER_REQUEST_FILE"] = previous


def deploy(state: State, runtime: Runtime, source: Path, delegation: Document) -> None:
    release, binding = package.inspect(source)
    loaded = state.load()
    require(loaded is None or (loaded[0]["status"] == "verified"
            and loaded[1]["phase"] in ("adoption", "completed")), "interrupted deployment requires readonly reconciliation")
    require(binding["generation"] > state.floor(), "stale automatic deployment generation")
    runtime.configure(source, release)
    runtime.verify_images(release)
    before = observation(runtime.observe())
    require(before["databaseIdentity"]["databaseName"] == runtime.environment["LABELER_DATABASE_NAME"],
            "automatic observed database differs from policy")
    require(before["dataBundle"] == "empty" or before["schema"] in ("013_category_definition_color",
            "014_copilot_369_cardinality", "study-schema-3", TARGET["schema"]), "unsupported automatic source schema")
    require(loaded is None or before["databaseIdentity"] == loaded[0]["databaseIdentity"], "automatic database identity changed")
    if loaded is not None and loaded[1]["phase"] == "completed":
        require(before["schema"] == loaded[0]["effectiveSchema"]
                and before["dataBundle"] == loaded[0]["effectiveDataBundle"], "completed automatic deployment state drift")
    inventory = runtime.inventory()
    running = [item["name"].removeprefix("/") for item in inventory if item["running"]]
    allowed = {"labeling-database", "labeling-server", "labeling-caddy", "labeling-study-prepare"}
    require(set(running) <= allowed, "unknown active writer blocks automatic deployment")
    stopped = [name for name in running if name != "labeling-database"]
    if stopped:
        runtime.command(["docker", "stop"] + stopped)
    runtime.writers_stopped()
    stopped_origin = runtime.observe()
    require(same_state(before, stopped_origin) and stopped_origin["readOnly"]["writersStopped"] is True,
            "automatic source changed or database writers remain")
    runtime.automation = delegation
    if loaded is None:
        recovery.adopt(state, runtime)
    observed = runtime.observe()
    with cutover_request(runtime, observed["dataBundle"] == "legacy300-v1"):
        if observed["schema"] == "014_copilot_369_cardinality":
            normalization.start(state, runtime, source)
            observed = runtime.observe()
        if observed["schema"] in ("013_category_definition_color", "study-schema-3"):
            history.start(state, runtime, source)
            lifecycle.continue_operation(state, runtime, "continue")
            if state.load()[1]["phase"] == "cutover_verified":
                lifecycle.deploy(state, runtime, source, "deploy")
            return
        require(observed["schema"] == TARGET["schema"] or observed["dataBundle"] == "empty",
                "unknown automatic deployment source")
        if observed["dataBundle"] == "legacy300-v1":
            lifecycle.deploy(state, runtime, source, "maintenance")
        lifecycle.deploy(state, runtime, source, "deploy")
