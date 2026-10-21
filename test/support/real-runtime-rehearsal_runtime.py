# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Socket-free adapter: finite IPC operations execute on the owning test process."""
from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path
from typing import Literal, TypedDict

import contracts
from runtime import Runtime

Operation = Literal["config", "inspect-db", "observer", "inventory-ids", "inventory-names",
                    "inventory-inspect", "up", "prepare", "smoke", "images", "fault", "checkpoint"]


class Response(TypedDict):
    code: int
    stdout: str


def exchange(operation: Operation, services: list[str] | None = None) -> bytes:
    print(json.dumps({"operation": operation, "services": services}), flush=True)
    value = contracts.shape(contracts.decode(sys.stdin.buffer.readline()), "code stdout")
    contracts.require(type(value["code"]) is int and type(value["stdout"]) is str, "invalid broker response")
    contracts.require(value["code"] == 0, "actual rehearsal host command failed: " + operation)
    return base64.b64decode(value["stdout"], validate=True)


class BrokerRuntime(Runtime):
    """Mutable Runtime transport; only resource names, local image binding and TLS differ."""

    def configure(self, directory: Path, release: contracts.Document) -> None:
        self.release = release
        self.stage = "compose-config"
        self.config = contracts.decode(exchange("config"))
        services = self.config["services"]
        contracts.require(set(services) == {"labeling-database", "labeling-study-prepare", "labeling-server", "labeling-caddy"},
                          "unexpected task services")
        contracts.require(all(service["read_only"] and not service.get("privileged") for service in services.values()),
                          "unsafe task services")
        self.compose = ["docker", "compose"]
        mounts = services["labeling-study-prepare"]["volumes"]
        targets = __import__("runtime").TARGETS
        self.validate_profiles([mount for mount in mounts if mount["target"] in targets])
        for service in services.values():
            for mount in service.get("volumes", []):
                if mount["type"] == "bind" and Path(mount["source"]).is_file():
                    contracts.require(mount["read_only"], "task bind must be readonly")
                    self.mount_hashes[mount["source"]] = hashlib.sha256(Path(mount["source"]).read_bytes()).hexdigest()

    def verify_images(self, _release: contracts.Document) -> None:
        self.stage = "image-preflight"
        value = contracts.decode(exchange("images"))
        contracts.require(value["sourceHashesVerified"] is True and value["pullPerformed"] is False,
                          "cached local image/source verification failed")

    def command(self, arguments: list[str], payload: bytes | None = None) -> bytes:
        if arguments[0] == self.environment.get("LABELER_BACKUP_COMMAND"):
            return super().command(arguments, payload)
        if arguments[0] == "curl":
            return exchange("smoke")
        if arguments[:2] == ["docker", "inspect"]:
            return exchange("inspect-db" if arguments[2:] == ["labeling-database"] else "inventory-inspect")
        if arguments[:2] == ["docker", "ps"]:
            return exchange("inventory-names" if arguments[-1] == "{{.Names}}" else "inventory-ids")
        if arguments[:2] == ["docker", "run"]:
            contracts.require(arguments[-2:] == ["scripts/study-readiness.js", "--normalization-probe"],
                              "only actual restricted observer is brokered")
            return exchange("observer")
        if arguments[:2] == self.compose and "up" in arguments:
            services = arguments[arguments.index("--wait") + 1:]
            return exchange("up", services)
        if arguments == self.compose + ["run", "--rm", "--no-deps", "labeling-study-prepare"]:
            self.stage = "prepare"
            return exchange("prepare")
        raise contracts.Rejected("command outside finite rehearsal transport")
