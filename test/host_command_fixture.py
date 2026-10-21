import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from host_fixture import auth, candidate, observed
import contracts
import manifest
from runtime import TARGETS
from consumer import fingerprint


class CommandFixture:
    def __init__(self, root):
        self.root = root
        self.deploy_root = root / "host"
        self.deploy_root.mkdir(mode=0o700)
        self.bin = root / "bin"
        self.bin.mkdir()
        for name in ("docker", "curl", "backup"):
            target = self.bin / name
            shutil.copyfile(Path(__file__).parent / f"fixtures/host/{name}-spy.py", target)
            target.chmod(0o755)
        self.origin = observed()
        self.target = observed(contracts.BUNDLE, contracts.SCHEMA)
        for name, value in (("observation", self.origin), ("target", self.target)):
            (root / f"{name}.json").write_text(json.dumps(value))
        (root / "artifacts.json").write_text(json.dumps(manifest.ARTIFACTS))
        self.directory, self.release, self.binding = candidate(root)
        self.mounts = {}
        for target in sorted(TARGETS):
            source = root / (target.replace("/", "_") + ".json")
            source.write_text("{}")
            source.chmod(0o440)
            self.mounts[target] = str(source)
        entries = []
        for index, (suffix, count, key) in enumerate((("current", 369, "pr-card-sorting-local"), ("validation-30", 30, "pr-card-sorting-validation-30"))):
            config = f"/run/config/studies/{suffix}.json"
            accounts = f"/run/secrets/studies/{suffix}.json"
            usernames = {name: name + ("-30" if count == 30 else "") for name in ("javier", "diego", "pablo")}
            Path(self.mounts[config]).write_text(json.dumps({"studyKey": key, "expectedCardCount": count, "participants": list(usernames), "loginUsernames": usernames}))
            Path(self.mounts[accounts]).write_text(json.dumps({"manifestVersion": 1, "studyKey": key,
                "accounts": [{"participantKey": name, "normalizedUsername": username, "passwordHash": "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$" + "a" * 43} for name, username in usernames.items()]}))
            entries.append({"config": config, "csv": manifest.ARTIFACTS[index * 2][0], "accountManifest": accounts, "enrichmentEnabled": False})
        Path(self.mounts["/run/config/study-profiles.json"]).write_text(json.dumps({"profiles": entries}))
        (root / "mounts.json").write_text(json.dumps({target: source for target, source in self.mounts.items() if target != "/run/secrets/database-password"}))
        prepare_mounts = [{"type": "bind", "source": source, "target": target, "read_only": True} for target, source in self.mounts.items()]
        prepare_mounts.append({"type": "bind", "source": "dynamic", "target": "/run/labeler-release/context.json", "read_only": True})
        services = {name: {"read_only": True, "volumes": []} for name in ("labeling-database", "labeling-study-prepare", "labeling-server", "labeling-caddy")}
        services["labeling-study-prepare"].update({"command": ["sh", "scripts/prepare-study-deployment.sh"], "volumes": prepare_mounts, "group_add": ["1000"],
            "environment": {"STUDY_PROFILES_INPUT": "/run/config/study-profiles.json", "STUDY_CONFIG_INPUT": "", "STUDY_CSV_PATH": manifest.ARTIFACTS[0][0],
                "LABELER_RELEASE_CONTEXT": "/run/labeler-release/context.json", "GITHUB_ENRICHMENT_ENABLED": "false",
                "DATABASE_HOST": "labeling-database", "DATABASE_PORT": "5432", "DATABASE_NAME": "labeling", "DATABASE_PASS_FILE": "/run/secrets/database-password"}})
        services["labeling-caddy"].update({"image": "caddy:2.8.4-alpine", "environment": {"PUBLIC_HOSTNAME": "labeler.example"},
            "volumes": [{"type": "bind", "source": "dynamic", "target": "/etc/caddy/Caddyfile", "read_only": True}]})
        (root / "compose.json").write_text(json.dumps({"name": "labeling", "services": services,
            "volumes": {"data": {"name": "labeling-data"}}, "networks": {"default": {"name": "labeling-network"}}}))
        (root / "database.json").write_text(json.dumps([{"State": {"Health": {"Status": "healthy"}},
            "Mounts": [{"Destination": "/var/lib/postgresql/data", "Name": "labeling-data", "Source": "/isolated/data"}]}]))
        (root / "production.env").write_text("DATABASE_NAME=labeling\n")
        (root / "inspection-password").write_text("isolated-placeholder")
        (root / "inspection-password").chmod(0o400)
        observer = root / "observer"
        observer.mkdir()
        for name in ("util", "scripts", "schema", "data"):
            (observer / name).mkdir()
        for filename, _checksum in manifest.ARTIFACTS:
            shutil.copyfile(Path(__file__).resolve().parents[1] / "plans" / Path(filename).name, observer / "data" / Path(filename).name)
        self.environment = {**os.environ, "SPY_ROOT": str(root), "PATH": str(self.bin) + ":" + os.environ["PATH"],
            "LABELER_DEPLOY_ROOT": str(self.deploy_root), "LABELER_ENV_FILE": str(root / "production.env"),
            "LABELER_BACKUP_COMMAND": str(self.bin / "backup"), "LABELER_AUTHORIZATION_FILE": str(root / "authorization.json"),
            "LABELER_PUBLIC_BASE_URL": "https://labeler.example", "LABELER_READONLY_PASSWORD_FILE": str(root / "inspection-password"),
            "LABELER_DATABASE_NAME": "labeling", "LABELER_READONLY_USER": "labeler_inspection", "LABELER_OBSERVER_IMAGE": self.release["images"]["server"],
            "LABELER_OBSERVER_ASSETS_ROOT": str(observer),
            "LABELER_OBSERVER_MOUNTS_FILE": str(root / "mounts.json")}
        self.write_backup()

    def write_authorization(self, action, binding=None):
        authorization = auth(action)
        authorization.pop("requestSha256")
        if action == "adopt":
            authorization["drain"] = {"pushesExcluded": True, "rerunsBlocked": True, "ciTerminal": True,
                "queued": [], "running": [], "awaitingApproval": [], "retryable": [], "inFlight": []}
        authorization.update(version=1, candidate=binding, databaseIdentity=self.origin["databaseIdentity"], consumerSha256=fingerprint(Path(self.environment["LABELER_OBSERVER_ASSETS_ROOT"]))["sha256"])
        (self.root / "authorization.json").write_text(json.dumps(authorization))

    def write_backup(self):
        archive = self.root / "full.dump.enc"
        archive.write_bytes(b"synthetic encrypted full custom dump fixture")
        globals_file = self.root / "globals-mapping.json"
        globals_file.write_text("{}")
        sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
        destination = {**self.origin["databaseIdentity"], "systemIdentifier": "98765", "volume": "isolated-restore:/restore", "endpoint": "restore:5432/restore"}
        value = {"kind": "labeler-full-postgresql-backup", "version": 1, "databaseIdentity": self.origin["databaseIdentity"], "origin": self.origin,
            "interval": {"startedAt": "2020-01-01T00:00:00Z", "completedAt": "2020-01-01T00:01:00Z"},
            "tools": {"pgDump": "17.6", "pgRestore": "17.6", "serverVersion": "170006"},
            "archive": {"format": "custom", "scope": "full-database", "location": str(archive), "sha256": sha(archive), "encryptionKeyRef": "fixture-key-ref", "retentionUntil": "2099-01-01T00:00:00Z"},
            "prerequisites": {"roles": [], "extensions": [], "tablespaces": [], "globals": {"disposition": "approved-mapping", "location": str(globals_file), "sha256": sha(globals_file)}},
            "restore": {"databaseIdentity": destination, "completedAt": "2020-01-01T00:02:00Z", "result": "verified", "schemaFingerprint": self.origin["schemaFingerprint"], "dataFingerprint": self.origin["fingerprint"], "archiveSha256": sha(archive)}, "writersStopped": True}
        (self.root / "backup.json").write_text(json.dumps(value))

    def run(self, action, payload=None, failure=""):
        entry = "control.py" if action.startswith("deploy ") or action == "rollback" else "../release-host-control.py"
        arguments = [] if entry == "control.py" else action.split()
        environment = {**self.environment, "SPY_FAILURE": failure}
        if entry == "control.py":
            environment["SSH_ORIGINAL_COMMAND"] = action
        return subprocess.run([sys.executable, "-B", str(Path(__file__).resolve().parents[1] / "deployment/host" / entry), *arguments],
            input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, timeout=30)

    def commands(self):
        file = self.root / "commands.log"
        return file.read_text() if file.exists() else ""
