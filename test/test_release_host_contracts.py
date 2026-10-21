import copy
import json
import tempfile
import unittest
import os
from unittest.mock import patch
from pathlib import Path

from host_fixture import archive, candidate, historical, observed, release
import contracts
import manifest
import package
import records


class ManifestContracts(unittest.TestCase):
    def test_rejects_invalid_nested_or_root_contract_when_ingress_is_ambiguous(self):
        valid = release()
        changes = [lambda value: value.update(schemaVersion=1), lambda value: value.update(extra=True),
            lambda value: value.pop("workflow"), lambda value: value.update(generation=True),
            lambda value: value.update(generation=1.0), lambda value: value.update(createdAt="2026-02-30T00:00:00Z"),
            lambda value: value.update(releaseId="01-1-" + value["commit"]),
            lambda value: value.update(workflow="password"),
            lambda value: value["images"].update(server=value["images"]["server"].replace("sha-", "sha-f")),
            lambda value: value["dataCompatibility"]["applicationSupports"].append("legacy300-v1"),
            lambda value: value["dataBundle"]["profiles"].reverse(),
            lambda value: value["dataBundle"]["profiles"].append(value["dataBundle"]["profiles"][0]),
            lambda value: value["dataBundle"]["profiles"].pop(),
            lambda value: value["dataBundle"]["profiles"].__setitem__(1, value["dataBundle"]["profiles"][0]),
            lambda value: value.update(generation=-1), lambda value: value.update(generation=2147483648),
            lambda value: value.update(commit="F" * 40), lambda value: value.update(releaseId="1-0-" + value["commit"]),
            lambda value: value.update(releaseId="2-1-" + value["commit"]),
            lambda value: value.update(workflow="release credential"),
            lambda value: value["images"].update(server=None), lambda value: value["images"].update(extra="image"),
            lambda value: value["schemaCompatibility"].update(produces="study-schema-2"),
            lambda value: value["schemaCompatibility"].update(applicationSupports=[]),
            lambda value: value["dataBundle"]["profiles"][0].update(expectedCardCount=300),
            lambda value: value["dataBundle"]["profiles"][0].update(expectedCardCount=369.0),
            lambda value: value["dataBundle"]["profiles"][0]["csv"].update(path="/labeling/data/pr-cards.csv"),
            lambda value: value["dataBundle"]["profiles"][1]["manifest"].update(path="/tmp/sidecar.json"),
            lambda value: value["dataBundle"]["profiles"][1]["csv"].update(extra="alias")]
        for index in range(4):
            changes.append(lambda value, index=index: value["dataBundle"]["profiles"][index // 2]["csv" if index % 2 == 0 else "manifest"].update(sha256="0" * 64))
            changes.append(lambda value, index=index: value["dataBundle"]["profiles"][index // 2]["csv" if index % 2 == 0 else "manifest"].pop("sha256"))
        for change in changes:
            with self.subTest(change=change):
                value = copy.deepcopy(valid)
                change(value)
                with self.assertRaises(contracts.Rejected):
                    manifest.validate(value)
        self.assertEqual(manifest.validate(valid), valid)

    def test_duplicate_and_non_utf8_json_rejected_when_decoding(self):
        for value in (b'{"key":1,"key":2}', b'{"nested":{"a":1,"a":2}}', b'\xff', b'{"a":NaN}', b" " * 65537):
            with self.subTest(raw=value[:32]), self.assertRaises(contracts.Rejected):
                contracts.decode(value)

    def test_archive_inventory_is_exact_when_hostile_members_arrive(self):
        for variant in ("duplicate", "extra", "traversal", "symlink", "hardlink"):
            with tempfile.TemporaryDirectory() as temporary, self.subTest(variant=variant):
                root = Path(temporary)
                with self.assertRaises(contracts.Rejected):
                    package.receive(archive(release(), variant), root / "staging")
                self.assertFalse((root / "releases").exists())

    def test_historical_bytes_remain_intact_when_inventory_reads_v1(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "release-manifest.json"
            raw = (json.dumps(historical(), indent=3) + "\n").encode()
            path.write_bytes(raw)
            path.chmod(0o440)
            self.assertEqual(manifest.historical(contracts.read(path))["schemaVersion"], 1)
            self.assertEqual(path.read_bytes(), raw)
            self.assertEqual(path.stat().st_mode & 0o777, 0o440)
            with self.assertRaises(contracts.Rejected):
                manifest.validate(contracts.read(path))

    def test_observation_requires_actual_readonly_grant_attestation(self):
        for key, value in (("grantsVerified", False), ("transaction", "read-write")):
            raw = observed()
            raw["readOnly"][key] = value
            with self.assertRaises(contracts.Rejected):
                contracts.observation(raw)

    def test_record_shapes_are_closed_when_unknown_or_missing_fields_arrive(self):
        from host_fixture import adopted
        from state import State
        with tempfile.TemporaryDirectory() as temporary:
            state = State(Path(temporary))
            valid = adopted(state)
            for mutation in (lambda value: value.update(extra=True), lambda value: value.pop("target"),
                             lambda value: value.update(version=True), lambda value: value.update(phase="almost-ready"),
                             lambda value: value["origin"]["readOnly"].update(clientClaim=True)):
                value = copy.deepcopy(valid)
                mutation(value)
                with self.assertRaises(contracts.Rejected):
                    records.receipt(value)
            self.assertEqual(len(valid), 12)
            self.assertEqual(len(contracts.read(state.path)), 12)

    def test_local_privileged_verbs_are_never_admitted_through_forced_ssh(self):
        from control import request
        for command in ("adopt", "reconcile", "continue", "finalize-publication", "maintenance " + release()["releaseId"]):
            with patch.dict(os.environ, {"SSH_ORIGINAL_COMMAND": command}), self.assertRaises(contracts.Rejected):
                request([], False)
        with patch.dict(os.environ, {"SSH_ORIGINAL_COMMAND": "deploy " + release()["releaseId"]}), self.assertRaises(contracts.Rejected):
            request([], True)


if __name__ == "__main__":
    unittest.main()
