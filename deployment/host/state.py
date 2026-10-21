from __future__ import annotations

import hashlib
import os
import uuid
import re
from pathlib import Path
from collections.abc import Iterator

import durable
import records
from contracts import Document, TARGET, encoded, read, require, same_state

NEXT = {
    "adoption": {"reserved", "unknown"}, "backup_verified": {"reserved"},
    "reserved": {"pending", "abandoned", "unknown"},
    "pending": {"normalization_verified", "cutover_verified", "abandoned", "unknown"},
    "normalization_verified": {"pending", "abandoned", "unknown"},
    "cutover_verified": {"runtime_verified", "abandoned", "unknown"},
    "runtime_verified": {"smoke_verified", "abandoned", "unknown"},
    "smoke_verified": {"publication_intent", "abandoned", "unknown"},
    "publication_intent": {"publication_metadata", "abandoned", "unknown"},
    "publication_metadata": {"completed", "abandoned", "unknown"},
    "completed": {"reserved", "unknown"}, "abandoned": {"pending", "normalization_verified", "cutover_verified", "runtime_verified", "publication_intent", "unknown"},
    "unknown": set(),
}


class State:
    def __init__(self, root: Path):
        self.root = root
        for name in ("state", "releases", "evidence", "incoming", "runtime"):
            durable.directory(root / name)
        self.path = root / "state/database-compatibility.json"

    def load(self) -> tuple[Document, Document] | None:
        if not self.path.exists():
            return None
        require(self.path.stat().st_uid == 0 and self.path.stat().st_mode & 0o022 == 0, "untrusted journal ownership")
        journal = records.journal(read(self.path))
        evidence = self.root / journal["evidenceRef"]
        require(evidence.resolve().is_relative_to((self.root / "evidence").resolve()), "unsafe evidence reference")
        require(evidence.stat().st_uid == 0 and evidence.stat().st_mode & 0o777 == 0o440, "untrusted immutable receipt")
        receipt = records.receipt(read(evidence))
        require(receipt["operationId"] == journal["operationId"] and receipt["databaseIdentity"] == journal["databaseIdentity"]
                and receipt["origin"] == journal["origin"] and journal["target"] ==
                {key: receipt["target"][key] for key in TARGET}, "journal receipt binding mismatch")
        candidate = receipt["candidate"]
        require((candidate is None and journal["releaseId"] is None and journal["generation"] is None)
                or (candidate is not None and candidate["releaseId"] == journal["releaseId"]
                    and candidate["generation"] == journal["generation"]), "journal candidate mismatch")
        seen = set()
        current = receipt
        for _step in range(32):
            predecessor = current["predecessorEvidence"]
            if predecessor is None:
                require(current["phase"] == "adoption", "unrooted evidence chain")
                break
            require(predecessor not in seen, "cyclic evidence chain")
            seen.add(predecessor)
            prior_path = self.root / predecessor
            require(prior_path.stat().st_uid == 0 and prior_path.stat().st_mode & 0o777 == 0o440, "untrusted predecessor receipt")
            prior = records.receipt(read(prior_path))
            if prior["operationId"] == current["operationId"]:
                require(current["phase"] in NEXT[prior["phase"]], "invalid receipt transition")
                require(all(prior[key] == current[key] for key in ("candidate", "databaseIdentity", "origin")), "transition binding changed")
                retargeted = any(prior["target"][key] != current["target"][key] for key in TARGET)
                if retargeted:
                    require(prior["phase"] == "normalization_verified" and current["phase"] == "pending"
                            and current["authorization"]["action"] == "continue"
                            and {key: current["target"][key] for key in TARGET} == TARGET,
                            "target can change only at authorized normalization checkpoint")
                if prior["phase"] == "normalization_verified" and current["phase"] == "pending":
                    require(current["authorization"]["action"] == "continue", "normalization checkpoint requires explicit continuation")
                if prior["phase"] in ("pending", "abandoned") and self.normalization_intent(prior):
                    require(current["phase"] in ("normalization_verified", "pending", "abandoned", "unknown"),
                            "normalization intent cannot become final release verification")
                    require(current["phase"] != "pending" or current["authorization"]["action"] == "maintenance-normalize",
                            "intact normalization source requires normalization authorization")
            else:
                require(current["phase"] == "reserved" and prior["phase"] in ("adoption", "completed"), "invalid operation predecessor")
                require(prior["databaseIdentity"] == current["databaseIdentity"], "operation changed database identity")
                break
            current = prior
        else:
            require(False, "evidence chain too long")
        if journal["status"] == "verified":
            observed = receipt["target"]["observation"] or receipt["origin"]
            require(journal["effectiveSchema"] == observed["schema"]
                    and journal["effectiveDataBundle"] == observed["dataBundle"]
                    and journal["lastVerifiedAt"] == observed["observedAt"], "unsupported verified state")
            require(receipt["phase"] in ("adoption", "normalization_verified", "cutover_verified", "runtime_verified", "smoke_verified",
                    "publication_intent", "publication_metadata", "completed", "abandoned"), "receipt phase cannot prove verified state")
        elif journal["status"] == "unknown":
            require(receipt["phase"] == "unknown", "unknown state requires unknown receipt")
        else:
            require(receipt["phase"] in ("reserved", "pending", "abandoned"), "pending journal phase mismatch")
        if receipt["phase"] == "completed":
            import publication
            desired = receipt["publication"]["desired"]
            require(publication.snapshot(self.root) == desired and desired["current"] == "releases/" + candidate["releaseId"], "completion conflicts with publication")
            matched = re.fullmatch(r"current=([^ ]+) previous=([^ ]*) generation=([0-9]+) schema=study-schema-3", desired["deployment"])
            require(matched is not None and int(matched[3]) == self.floor()
                    and matched[1] == candidate["releaseId"]
                    and matched[2] == (desired["previous"] or "").removeprefix("releases/"), "completion conflicts with generation floor or previous pointer")
        return journal, receipt

    def save(self, receipt: Document, status: str) -> Document:
        records.receipt(receipt)
        operation = receipt["operationId"]
        evidence = self.root / "evidence" / ("adoption" if receipt["candidate"] is None else receipt["candidate"]["releaseId"])
        durable.directory(evidence)
        destination = evidence / f"{operation}-{receipt['phase']}-{uuid.uuid4()}.json"
        durable.document(destination, receipt, immutable=True)
        observed = receipt["target"]["observation"] or receipt["origin"]
        candidate = receipt["candidate"]
        journal = records.journal({"formatVersion": 1, "status": status, "operationId": operation,
            "releaseId": candidate["releaseId"] if candidate else None,
            "generation": candidate["generation"] if candidate else None,
            "target": {key: receipt["target"][key] for key in TARGET},
            "databaseIdentity": receipt["databaseIdentity"], "origin": receipt["origin"],
            "effectiveSchema": observed["schema"] if status == "verified" else None,
            "effectiveDataBundle": observed["dataBundle"] if status == "verified" else None,
            "lastVerifiedAt": observed["observedAt"] if status == "verified" else None,
            "evidenceRef": str(destination.relative_to(self.root))})
        durable.document(self.path, journal)
        return journal

    def advance(self, receipt: Document, phase: str, status: str = "pending") -> Document:
        loaded = self.load()
        require(loaded is not None and all(loaded[1][key] == receipt[key] for key in
                ("operationId", "candidate", "databaseIdentity", "origin", "phase")), "receipt is not authoritative")
        require(phase in NEXT[receipt["phase"]], "undeclared phase transition")
        successor = {**receipt, "phase": phase, "predecessorEvidence": loaded[0]["evidenceRef"]}
        self.save(successor, status)
        return successor

    def floor(self) -> int:
        path = self.root / "state/highest-generation"
        if not path.exists():
            return -1
        require(path.is_file() and not path.is_symlink(), "unsafe generation floor")
        require(path.stat().st_uid == 0 and path.stat().st_mode & 0o022 == 0, "untrusted generation floor ownership")
        value = path.read_text().strip()
        require(value.isdecimal() and str(int(value)) == value and int(value) <= 2147483647, "invalid generation floor")
        return int(value)

    def reserve(self, binding: Document, observed: Document, authorization: Document) -> Document:
        loaded = self.load()
        require(loaded is not None, "host adoption required")
        journal, predecessor = loaded
        require(journal["status"] == "verified" and predecessor["phase"] in ("adoption", "completed"), "reconciliation required before reservation")
        require(journal["databaseIdentity"] == observed["databaseIdentity"], "database identity changed")
        require(binding["generation"] > self.floor(), "stale generation or replay")
        receipt = records.receipt({"kind": "labeler-host-operation", "version": 1,
            "operationId": f"release-{uuid.uuid4()}", "candidate": binding,
            "databaseIdentity": observed["databaseIdentity"], "phase": "reserved",
            "predecessorEvidence": journal["evidenceRef"], "authorization": authorization,
            "backupRef": None, "origin": observed,
            "target": {**TARGET, "dataBundle": observed["dataBundle"] if authorization["action"] == "maintenance-normalize" else TARGET["dataBundle"],
                       "observation": None}, "publication": None})
        self.save(receipt, "pending")
        durable.write(self.root / "state/highest-generation", f"{binding['generation']}\n".encode())
        return receipt

    def handoff(self, receipt: Document, observed: Document, gid: int) -> Path:
        loaded = self.load()
        require(loaded is not None and loaded[1] == receipt and receipt["phase"] == "pending", "own pending receipt required")
        require(same_state(self.baseline(receipt), observed), "handoff observation drift")
        operation_directory = self.root / "runtime" / receipt["operationId"]
        durable.directory(operation_directory)
        directory = operation_directory / str(uuid.uuid4())
        durable.directory(directory)
        require(os.geteuid() == 0 and directory.stat().st_uid == 0 and directory.stat().st_mode & 0o777 == 0o700, "handoff requires root private directory")
        path = directory / "context.json"
        context = {"version": 1, "operationId": receipt["operationId"], "candidate": receipt["candidate"],
            "databaseIdentity": receipt["databaseIdentity"], "phase": "pending", "receipt": receipt,
            "receiptSha256": hashlib.sha256(encoded(receipt)).hexdigest(), "observation": observed}
        durable.document(path, context, immutable=True)
        os.chown(path, 0, gid)
        with path.open("rb") as stream:
            os.fsync(stream.fileno())
        durable.sync_directory(directory)
        return path

    def predecessors(self, receipt: Document) -> Iterator[Document]:
        current = receipt
        for _step in range(32):
            yield current
            if current["predecessorEvidence"] is None:
                return
            prior = records.receipt(read(self.root / current["predecessorEvidence"]))
            if prior["operationId"] != receipt["operationId"]:
                return
            current = prior
        require(False, "evidence chain too long")

    def baseline(self, receipt: Document) -> Document:
        for prior in self.predecessors(receipt):
            if prior["target"]["observation"] is not None:
                return prior["target"]["observation"]
        return receipt["origin"]

    def normalization_intent(self, receipt: Document) -> bool:
        for prior in self.predecessors(receipt):
            if prior["phase"] == "normalization_verified":
                return True
            if prior["phase"] in ("pending", "reserved") and prior["authorization"]["action"] != "reconcile":
                return prior["authorization"]["action"] == "maintenance-normalize"
        return False

    def has_normalization_checkpoint(self, receipt: Document) -> bool:
        return any(prior["phase"] == "normalization_verified" for prior in self.predecessors(receipt))
