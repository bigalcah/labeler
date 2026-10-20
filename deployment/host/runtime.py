from __future__ import annotations

import hashlib
import os
import re
import subprocess
from pathlib import Path

import manifest
from contracts import Document, Json, Rejected, decode, read, require, shape

TARGETS = {"/run/config/study-profiles.json", "/run/config/studies/current.json",
           "/run/config/studies/validation-30.json", "/run/secrets/studies/current.json",
           "/run/secrets/studies/validation-30.json", "/run/secrets/database-password"}


class Runtime:
    def __init__(self, root: Path):
        self.root = root
        self.environment = os.environ.copy()
        self.env_file = self.external(self.environment.get("LABELER_ENV_FILE", ""))
        self.url = self.environment.get("LABELER_PUBLIC_BASE_URL", "")
        require(re.fullmatch(r"https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?", self.url) is not None, "public HTTPS origin required")
        require(not any(key in self.environment for key in ("PGPASSWORD", "STUDY_BACKUP_ENCRYPTION_PASSPHRASE")), "inline secrets forbidden")
        require(re.search(r"(?im)^\s*(?:export\s+)?(?:PGPASSWORD|STUDY_BACKUP_ENCRYPTION_PASSPHRASE)\s*=", self.env_file.read_text()) is None,
                "forbidden inline secret")
        self.compose: list[str] = []
        self.config: Document = {}
        self.mount_hashes: dict[str, str] = {}
        self.mount_identities: dict[str, tuple[int, ...]] = {}
        self.release: Document = {}
        self.stage = "configuration"
        self.summary: Document | None = None
        self.compose_diagnostic = b""

    def external(self, value: str) -> Path:
        path = Path(value)
        require(path.is_absolute() and path.is_file() and not path.is_symlink()
                and not path.resolve().is_relative_to(self.root.resolve()), "external regular file required")
        require(path.stat().st_uid in (0, 1000) and path.stat().st_mode & 0o022 == 0, "external files require trusted ownership and non-writable permissions")
        return path

    def command(self, arguments: list[str], payload: bytes | None = None) -> bytes:
        if "labeling-study-prepare" in arguments and "run" in arguments:
            self.stage = "migration" if "scripts/migrate-study-schema.js" in arguments else "prepare"
        if "scripts/cutover-copilot-369.js" in arguments:
            self.stage = "cutover"
        try:
            result = subprocess.run(arguments, input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    env=self.environment, timeout=300, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise Rejected("host command unavailable or timed out") from error
        if arguments[-3:] == ["config", "--format", "json"]:
            self.compose_diagnostic = b"WARNING: version is obsolete\n" if b"version" in result.stderr and b"obsolete" in result.stderr else b""
        require(result.returncode == 0, "host command failed")
        require(len(result.stdout) <= 1048576, "host command response exceeds limit")
        return result.stdout

    def configure(self, directory: Path, release: Document) -> None:
        self.stage = "compose-config"
        self.release = release
        self.environment.update({"LABELER_SERVER_IMAGE": release["images"]["server"],
            "LABELER_DATABASE_IMAGE": release["images"]["database"],
            "LABELER_RELEASE_CONTEXT_HOST_PATH": str(self.root / "runtime/context-placeholder.json")})
        self.compose = ["docker", "compose", "--env-file", str(self.env_file), "-f", str(directory / "docker-compose.yml")]
        self.config = decode(self.command(self.compose + ["config", "--format", "json"]))
        services = self.config.get("services", {})
        require(self.config.get("name") == "labeling" and set(services) ==
                {"labeling-database", "labeling-study-prepare", "labeling-server", "labeling-caddy"}, "Compose project identity mismatch")
        require(self.config["volumes"]["data"]["name"] == "labeling-data"
                and self.config["networks"]["default"]["name"] == "labeling-network", "Compose persistent identity mismatch")
        for name, service in services.items():
            expected = release["images"]["database" if name == "labeling-database" else "server"]
            require(service.get("image") == ("caddy:2.8.4-alpine" if name == "labeling-caddy" else expected), "Compose image mismatch")
            require(not service.get("privileged") and not service.get("entrypoint") and not service.get("devices")
                    and not service.get("network_mode") and service.get("read_only") is True, "unsafe Compose execution context")
            if name != "labeling-study-prepare":
                require(not service.get("command"), "unexpected runtime command")
            else:
                require(service.get("command") == ["sh", "scripts/prepare-study-deployment.sh"], "untrusted prepare command")
            if name in ("labeling-database", "labeling-server"):
                require(not service.get("ports"), "database and server must remain private")
            for key in service.get("environment", {}):
                require(not re.search(r"PASSWORD|SECRET|TOKEN|CREDENTIAL|PRIVATE_KEY", key, re.I)
                        or key.endswith(("_FILE", "_PREVIOUS_FILE")), "inline runtime secret field forbidden")
            for mount in service.get("volumes", []):
                if mount.get("type") != "bind":
                    continue
                target = mount.get("target", "")
                require(mount.get("read_only") is True, "bind mount must be readonly")
                if target == "/run/labeler-release/context.json":
                    require(name == "labeling-study-prepare" and mount.get("source") == self.environment["LABELER_RELEASE_CONTEXT_HOST_PATH"], "context is prepare-only")
                    continue
                source = self.external(mount.get("source", "")) if target != "/etc/caddy/Caddyfile" else Path(mount["source"])
                require(target != "/etc/caddy/Caddyfile" or source.resolve() == (directory / "Caddyfile").resolve(), "Caddy configuration mismatch")
                if name != "labeling-study-prepare":
                    require(not target.startswith(("/run/config/", "/run/secrets/studies/")), "profile mounts leaked to runtime")
                checksum = hashlib.sha256(source.read_bytes()).hexdigest()
                require(str(source) not in self.mount_hashes or self.mount_hashes[str(source)] == checksum, "external mount changed during preflight")
                self.mount_hashes[str(source)] = checksum
                if target != "/etc/caddy/Caddyfile":
                    metadata = source.stat()
                    identity = (metadata.st_dev, metadata.st_ino, metadata.st_uid, metadata.st_gid, metadata.st_mode)
                    require(str(source) not in self.mount_identities or self.mount_identities[str(source)] == identity,
                            "external mount identity changed during preflight")
                    self.mount_identities[str(source)] = identity
        prepare = services["labeling-study-prepare"]
        require(prepare.get("group_add") == ["1000"], "prepare context group mapping is required")
        mounts = prepare.get("volumes", [])
        require({mount["target"] for mount in mounts} == TARGETS | {"/run/labeler-release/context.json"}, "unexpected prepare mounts")
        environment = prepare.get("environment", {})
        require(environment.get("DATABASE_HOST") == "labeling-database" and str(environment.get("DATABASE_PORT")) == "5432"
                and environment.get("DATABASE_NAME") == self.environment["LABELER_DATABASE_NAME"]
                and environment.get("DATABASE_PASS_FILE") == "/run/secrets/database-password", "prepare database endpoint binding mismatch")
        require(environment.get("STUDY_PROFILES_INPUT") == "/run/config/study-profiles.json"
                and environment.get("STUDY_CONFIG_INPUT") == ""
                and environment.get("STUDY_CSV_PATH") == manifest.ARTIFACTS[0][0]
                and environment.get("GITHUB_ENRICHMENT_ENABLED") in ("false", False)
                and environment.get("LABELER_RELEASE_CONTEXT") == "/run/labeler-release/context.json", "prepare profile identity mismatch")
        hostname = "https://" + services["labeling-caddy"]["environment"]["PUBLIC_HOSTNAME"]
        require(self.url == hostname or self.url.startswith(hostname + ":"), "smoke origin mismatch")
        self.validate_profiles(mounts)
        self.summary = {"name": "labeling", "services": {name: {"image": service["image"], "read_only": True}
            for name, service in services.items()}}

    def validate_profiles(self, mounts: list[Document]) -> None:
        sources = {mount["target"]: Path(mount["source"]) for mount in mounts}
        descriptor = shape(read(sources["/run/config/study-profiles.json"]), "profiles")
        expected = []
        for index, (suffix, count, key) in enumerate((("current", 369, "pr-card-sorting-local"), ("validation-30", 30, "pr-card-sorting-validation-30"))):
            config_path = f"/run/config/studies/{suffix}.json"
            accounts_path = f"/run/secrets/studies/{suffix}.json"
            expected.append({"config": config_path, "csv": manifest.ARTIFACTS[index * 2][0], "accountManifest": accounts_path, "enrichmentEnabled": False})
            config = read(sources[config_path])
            usernames = {key: key + ("-30" if count == 30 else "") for key in ("javier", "diego", "pablo")}
            require(config in ({"studyKey": key, "expectedCardCount": count, "participants": list(usernames)},
                               {"studyKey": key, "expectedCardCount": count, "participants": list(usernames), "loginUsernames": usernames}), "external profile configuration mismatch")
            accounts = shape(read(sources[accounts_path]), "manifestVersion studyKey accounts")
            require(accounts["manifestVersion"] == 1 and accounts["studyKey"] == key
                    and type(accounts["accounts"]) is list and len(accounts["accounts"]) == 3, "external account manifest mismatch")
            for ordinal, username in enumerate(usernames):
                account = shape(accounts["accounts"][ordinal], "participantKey normalizedUsername passwordHash")
                require(account["participantKey"] == username and account["normalizedUsername"] == usernames[username]
                        and re.fullmatch(r"\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+", account["passwordHash"]) is not None, "external account identity mismatch")
        require(descriptor["profiles"] == expected, "external ordered descriptor mismatch")

    def verify_images(self, release: Document) -> None:
        self.stage = "image-preflight"
        for image in release["images"].values():
            self.command(["docker", "pull", image])
            inspected = decode(self.command(["docker", "image", "inspect", image]))[0]
            repository = image.split(":sha-")[0]
            require(repository + "@" + image.split("@")[1] in inspected.get("RepoDigests", []), "actual image digest mismatch")
            require(inspected.get("Config", {}).get("Labels", {}).get("org.opencontainers.image.revision") == release["commit"], "actual image revision mismatch")
        arguments = ["docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--entrypoint", "sha256sum", release["images"]["server"]]
        lines = self.command(arguments + [item[0] for item in manifest.ARTIFACTS]).decode().splitlines()
        require(lines == [checksum + "  " + filename for filename, checksum in manifest.ARTIFACTS], "image bundle checksum mismatch")
        for selector in ("-u", "-g"):
            actual = self.command(["docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
                "--entrypoint", "id", release["images"]["server"], selector]).strip()
            require(actual == b"1000", "prepare image must use the mapped unprivileged UID/GID 1000")
        if self.config:
            validation = ["docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL"]
            for mount in self.config["services"]["labeling-study-prepare"]["volumes"]:
                if mount["target"] in TARGETS - {"/run/secrets/database-password"}:
                    validation += ["--mount", f"type=bind,src={mount['source']},dst={mount['target']},readonly"]
            self.command(validation + ["-e", "STUDY_PROFILES_INPUT=/run/config/study-profiles.json",
                "-e", "GITHUB_ENRICHMENT_ENABLED=false", "--entrypoint", "node", release["images"]["server"], "scripts/validate-study-profiles.js"])

    def observe(self) -> Document:
        return self.normalization_probe()["observation"]

    def normalization_probe(self) -> Document:
        from observer import probe
        return probe(self)

    def verify_normalization_source(self) -> None:
        self.stage = "normalization-preflight"
        output = self.command(["docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
            "--entrypoint", "node", self.release["images"]["server"], "--input-type=module", "-e",
            "import {readNormalizationSource} from './util/study-ledger.js'; const {contract}=await readNormalizationSource(); process.stdout.write(contract.migration.sha256);"])
        require(output == b"53f8188e453101b9a06f16e1b2891c7538aecaed8e83b954d00cf3e6a4dbf951", "normalization source pin mismatch")

    def normalize(self) -> None:
        self.stage = "normalization"
        self.unchanged_mounts()
        self.command(self.compose + ["run", "--rm", "--no-deps", "--entrypoint", "node",
            "labeling-study-prepare", "scripts/normalize-retired-study-schema.js"])

    def unchanged_mounts(self) -> None:
        for name, checksum in self.mount_hashes.items():
            path = Path(name)
            require(path.is_file() and not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest() == checksum,
                    "external mount changed since preflight")
            if name in self.mount_identities:
                metadata = path.stat()
                require((metadata.st_dev, metadata.st_ino, metadata.st_uid, metadata.st_gid, metadata.st_mode) == self.mount_identities[name],
                        "external mount identity or permissions changed since preflight")

    def up(self, services: list[str]) -> None:
        self.stage = "database" if services == ["labeling-database"] else "runtime"
        self.unchanged_mounts()
        self.command(self.compose + ["up", "-d", "--no-build", "--no-deps", "--wait"] + services)

    def smoke(self) -> None:
        self.stage = "smoke"
        status = self.command(["curl", "--fail", "--silent", "--show-error", "--max-time", "30",
            "--output", "/dev/null", "--write-out", "%{http_code}", self.url + "/login"])
        require(status == b"200", "public HTTPS login smoke must return 200")

    def inventory(self) -> Json:
        identifiers = self.command(["docker", "ps", "-a", "--filter", "network=labeling-network", "--format", "{{.ID}}"]).decode().splitlines()
        if not identifiers:
            return []
        inspected = decode(self.command(["docker", "inspect"] + identifiers))
        return [{"id": item["Id"], "name": item["Name"], "startedAt": item["State"]["StartedAt"],
                 "image": item["Config"]["Image"], "running": item["State"]["Running"]} for item in inspected]

    def check_runtime(self) -> None:
        values = decode(self.command(["docker", "inspect", "labeling-server", "labeling-caddy"]))
        require(len(values) == 2 and all(value["State"].get("Health", {}).get("Status") == "healthy" for value in values), "runtime health not proved")
        require(values[0]["Config"]["Image"] == self.release["images"]["server"], "runtime candidate mismatch")

    def writers_stopped(self) -> None:
        containers = self.command(["docker", "ps", "--filter", "network=labeling-network", "--format", "{{.Names}}"])
        require(set(containers.decode().splitlines()) <= {"labeling-database"}, "stop all application, preparation and enrichment writers before backup or maintenance")

    def maintenance(self) -> None:
        request = self.external(self.environment.get("LABELER_CUTOVER_REQUEST_FILE", ""))
        value = read(request)
        require(value.get("confirmation") == "cutover-primary-300-to-copilot-369", "dedicated cutover request required")
        password = self.external(value.get("database", {}).get("passwordFile", ""))
        require(value["database"]["host"] == "labeling-database" and value["database"]["port"] == 5432
                and value["database"]["database"] == self.environment["LABELER_DATABASE_NAME"], "cutover database binding mismatch")
        arguments = ["docker", "run", "--rm", "--network", "labeling-network", "--read-only", "--cap-drop", "ALL",
            "--mount", f"type=bind,src={request},dst={request},readonly",
            "--mount", f"type=bind,src={password},dst={password},readonly", "--entrypoint", "node",
            self.release["images"]["server"], "scripts/cutover-copilot-369.js", "--request", str(request)]
        self.command(self.compose + ["run", "--rm", "--no-deps", "--entrypoint", "node", "labeling-study-prepare", "scripts/migrate-study-schema.js"])
        self.command(arguments)
