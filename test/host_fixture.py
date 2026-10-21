from __future__ import annotations

import copy
import hashlib
import io
import json
import sys
import tarfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deployment/host"))
import contracts
import durable
import manifest
import package
from state import State


def release(generation=1):
    commit = f"{generation:040x}"
    profiles = []
    for index, (key, count) in enumerate((("pr-card-sorting-local", 369), ("pr-card-sorting-validation-30", 30))):
        profiles.append({"studyKey": key, "expectedCardCount": count,
            "csv": dict(zip(("path", "sha256"), manifest.ARTIFACTS[index * 2])),
            "manifest": dict(zip(("path", "sha256"), manifest.ARTIFACTS[index * 2 + 1]))})
    return {"schemaVersion": 2, "releaseId": f"{generation}-1-{commit}", "generation": generation,
        "commit": commit, "images": {key: f"ghcr.io/example/{key}:sha-{commit}@sha256:{'a' if key == 'server' else 'b'}" + ("a" if key == "server" else "b") * 63 for key in ("server", "database")},
        "dataBundle": {"profiles": profiles}, "schemaCompatibility": {"produces": contracts.SCHEMA, "applicationSupports": [contracts.SCHEMA]},
        "dataCompatibility": {"produces": contracts.BUNDLE, "applicationSupports": [contracts.BUNDLE]},
        "workflow": "release/1/1", "createdAt": "2026-10-17T00:00:00Z"}


def historical(generation=0):
    current = release(generation)
    return {key: value for key, value in current.items() if key not in ("dataBundle", "dataCompatibility")} | {
        "schemaVersion": 1, "csv": {"path": "/labeling/data/pr-cards.csv", "sha256": "c" * 64, "commit": current["commit"]},
        "schemaCompatibility": {"produces": "study-schema-2", "applicationSupports": ["study-schema-2"]}}


def observed(bundle="empty", schema="empty"):
    return {"schema": schema, "dataBundle": bundle, "fingerprint": hashlib.sha256(bundle.encode()).hexdigest(),
        "schemaFingerprint": hashlib.sha256(schema.encode()).hexdigest(), "observedAt": contracts.now(),
        "databaseIdentity": {"systemIdentifier": "12345", "databaseOid": "16384", "databaseName": "labeling",
            "serverVersion": "170006", "endpoint": "labeling-database:5432/labeling", "volume": "labeling-data:/isolated/data"},
        "readOnly": {"role": "labeler_inspection", "transaction": "read-only", "grantsVerified": True, "writersStopped": True}}


def auth(action="deploy"):
    return {"action": action, "actor": "synthetic-operator", "issuedAt": "2020-01-01T00:00:00Z",
        "expiresAt": "2099-01-01T00:00:00Z", "requestSha256": "d" * 64, "writersStopped": True, "drain": None}


def archive(value, variant="valid"):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as bundle:
        for name, payload in (("release-manifest.json", json.dumps(value).encode()), ("docker-compose.yml", b"services: {}\n"), ("Caddyfile", b"https://{$PUBLIC_HOSTNAME} {}\n")):
            entry = tarfile.TarInfo(name)
            entry.size = len(payload)
            if variant in ("symlink", "hardlink") and name == "Caddyfile":
                entry.type = tarfile.SYMTYPE if variant == "symlink" else tarfile.LNKTYPE
                entry.linkname = "docker-compose.yml"
                entry.size = 0
            bundle.addfile(entry, io.BytesIO(payload))
        if variant in ("duplicate", "extra", "traversal"):
            entry = tarfile.TarInfo({"duplicate": "Caddyfile", "extra": "secret.env", "traversal": "../escape"}[variant])
            bundle.addfile(entry, io.BytesIO())
    output.seek(0)
    return output


def candidate(root, generation=1):
    directory = root / f"candidate-{generation}"
    value, binding = package.receive(archive(release(generation)), directory)
    return directory, value, binding


def adopted(state, origin=None):
    origin = origin or observed()
    receipt = {"kind": "labeler-host-operation", "version": 1, "operationId": "adoption-00000000-0000-0000-0000-000000000001",
        "candidate": None, "databaseIdentity": origin["databaseIdentity"], "phase": "adoption", "predecessorEvidence": None,
        "authorization": auth("adopt"), "backupRef": None, "origin": origin,
        "target": {**contracts.TARGET, "observation": origin if origin["schema"] == contracts.SCHEMA and origin["dataBundle"] == contracts.BUNDLE else None}, "publication": None}
    state.save(receipt, "verified")
    from recovery import inventory
    durable.document(state.root / "evidence/adoption" / (receipt["operationId"] + "-inventory.json"),
                     inventory(state, FakeRuntime(state.root, origin)), immutable=True)
    return receipt


class FakeRuntime:
    def __init__(self, root, origin=None):
        self.root = root
        self.value = origin or observed()
        self.environment = {}
        self.commands = []
        self.compose = ["docker", "compose"]
        self.failure = None
        self.release = {}

    def configure(self, directory, value):
        self.commands.append("config")
        self.release = value
        contracts.require(self.failure != "config", "config failed")

    def verify_images(self, value):
        self.commands.append("images")
        contracts.require(self.failure != "images", "image preflight failed")

    def observe(self):
        self.commands.append("observe")
        return copy.deepcopy(self.value)

    def normalization_probe(self):
        self.commands.append("normalization-probe")
        applied = getattr(self, "applied015", False)
        return {"observation": copy.deepcopy(self.value), "applied015": applied,
                "eligibility": "already-applied" if applied else "eligible"}

    def verify_normalization_source(self):
        self.commands.append("normalization-source")
        contracts.require(self.failure != "normalization-source", "source pin mismatch")

    def normalize(self):
        self.commands.append("normalize")
        contracts.require(self.failure != "normalization", "normalization failed before commit")
        self.value = observed(self.value["dataBundle"], contracts.SCHEMA)
        self.value["fingerprint"] = hashlib.sha256((self.value["dataBundle"] + "015").encode()).hexdigest()
        self.applied015 = True
        contracts.require(self.failure != "post-commit", "normalization response lost after commit")

    def writers_stopped(self):
        self.commands.append("writers-stopped")

    def external(self, value):
        return Path(value)

    def unchanged_mounts(self):
        self.commands.append("mounts")

    def inventory(self):
        self.commands.append("inventory")
        return []

    def up(self, services):
        self.commands.append("up " + " ".join(services))
        contracts.require(not (self.failure == "runtime" and "labeling-server" in services), "runtime failed")

    def command(self, arguments):
        self.commands.append(" ".join(arguments))
        contracts.require(self.failure != "prepare", "prepare failed")
        if "labeling-study-prepare" in arguments:
            self.value = observed(contracts.BUNDLE, contracts.SCHEMA)
        return b""

    def maintenance(self):
        self.commands.append("cutover")
        contracts.require(self.failure != "cutover", "cutover failed")
        self.value = observed(contracts.BUNDLE, contracts.SCHEMA)

    def check_runtime(self):
        self.commands.append("check-runtime")

    def smoke(self):
        self.commands.append("smoke")
        contracts.require(self.failure != "smoke", "smoke failed")
