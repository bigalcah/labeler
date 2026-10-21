from __future__ import annotations

import json
import os
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

from host_fixture import FakeRuntime, archive, candidate, historical, observed
from host_command_fixture import CommandFixture
import automatic
import contracts
import durable
from consumer import fingerprint
from state import State
from runtime import Runtime


class AutomaticDeployment(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "host"
        self.root.mkdir(mode=0o700)
        self.state = State(self.root)
        self.source, self.release, self.binding = candidate(self.root, 10)
        self.runtime = FakeRuntime(self.root, observed(contracts.BUNDLE, contracts.SCHEMA))
        self.runtime.env_file = Path(temporary.name) / "production.env"
        self.runtime.environment["LABELER_DATABASE_NAME"] = "labeling"
        self.policy_path = self.runtime.env_file.parent / "automatic-deployment.json"
        self.delegation = {"policySha256": "d" * 64, "backupRequired": False}

    def test_exact_pair_deploys_without_external_authorization_or_backup(self) -> None:
        automatic.deploy(self.state, self.runtime, self.source, self.delegation)
        journal, receipt = self.state.load()
        self.assertEqual((journal["status"], receipt["phase"]), ("verified", "completed"))
        self.assertIsNone(receipt["backupRef"])
        self.assertEqual(receipt["authorization"]["automation"], self.delegation)
        self.assertFalse(any("backup" in command or "cutover" in command for command in self.runtime.commands))
        self.assertEqual(self.runtime.commands.count("preserve-history"), 0)

    def test_successive_release_keeps_existing_pair_without_cutover_or_history(self) -> None:
        automatic.deploy(self.state, self.runtime, self.source, self.delegation)
        before = dict(self.runtime.value)
        source, _release, _binding = candidate(self.root, 11)
        automatic.deploy(self.state, self.runtime, source, self.delegation)
        self.assertEqual(self.state.load()[1]["phase"], "completed")
        self.assertEqual(self.state.floor(), 11)
        self.assertEqual(self.runtime.value["fingerprint"], before["fingerprint"])
        self.assertNotIn("cutover", self.runtime.commands)
        self.assertNotIn("preserve-history", self.runtime.commands)

    def test_retired_empty_origin_normalizes_then_initializes_without_backup(self) -> None:
        self.runtime.value = observed("empty", contracts.RETIRED)
        self.runtime.value["schemaFingerprint"] = contracts.RETIRED_FINGERPRINT
        automatic.deploy(self.state, self.runtime, self.source, self.delegation)
        self.assertEqual(self.state.load()[1]["phase"], "completed")
        self.assertEqual(self.runtime.commands.count("normalize"), 1)
        self.assertEqual(self.runtime.commands.count("preserve-history"), 1)
        self.assertIsNone(self.state.load()[1]["backupRef"])

    def test_historical_primary_runs_history_and_cutover_once_without_backup(self) -> None:
        baseline = historical()
        directory = self.root / "releases" / baseline["releaseId"]
        durable.directory(directory)
        durable.document(directory / "release-manifest.json", baseline)
        for name in ("current", "previous"):
            os.symlink("releases/" + baseline["releaseId"], self.root / name)
        original = (directory / "release-manifest.json").read_bytes()
        self.runtime.value = observed("legacy300-v1", "013_category_definition_color")
        with patch("automatic.cutover_request", return_value=nullcontext()):
            automatic.deploy(self.state, self.runtime, self.source, self.delegation)
        self.assertEqual(self.state.load()[1]["phase"], "completed")
        self.assertEqual(self.runtime.commands.count("preserve-history"), 1)
        self.assertEqual(self.runtime.commands.count("cutover"), 1)
        self.assertIsNone(self.state.load()[1]["backupRef"])
        self.assertEqual((directory / "release-manifest.json").read_bytes(), original)

    def test_replay_or_pending_state_never_repeats_sql(self) -> None:
        automatic.deploy(self.state, self.runtime, self.source, self.delegation)
        commands = list(self.runtime.commands)
        with self.assertRaises(contracts.Rejected):
            automatic.deploy(self.state, self.runtime, self.source, self.delegation)
        self.assertEqual(self.runtime.commands, commands)
        receipt = self.state.load()[1]
        self.state.save({**receipt, "phase": "unknown"}, "unknown")
        source, _release, _binding = candidate(self.root, 11)
        with self.assertRaises(contracts.Rejected):
            automatic.deploy(self.state, self.runtime, source, self.delegation)
        self.assertEqual(self.runtime.commands, commands)

    def test_policy_rejects_different_consumer_repository_database_or_permissions(self) -> None:
        self.runtime.external = Runtime.external.__get__(self.runtime)
        release = json.loads(json.dumps(self.release))
        for service, image in release["images"].items():
            release["images"][service] = image.replace(f"ghcr.io/example/{service}", f"ghcr.io/bigalcah/labeler-{service}")
        policy = {"version": 1, "repository": "bigalcah/labeler", "databaseName": "labeling",
            "consumerSha256": fingerprint()["sha256"], "backupRequired": False,
            "allowHistoricalCutover": True, "legacyIngressDisabled": True}
        self.assertIsNone(automatic.policy(self.runtime, release))
        self.policy_path.write_text(json.dumps(policy))
        self.policy_path.chmod(0o400)
        self.assertFalse(automatic.policy(self.runtime, release)["backupRequired"])
        for key, value in (("consumerSha256", "0" * 64), ("repository", "other/project"),
                           ("databaseName", "other"), ("backupRequired", True), ("legacyIngressDisabled", False)):
            self.policy_path.chmod(0o600)
            self.policy_path.write_text(json.dumps({**policy, key: value}))
            self.policy_path.chmod(0o400)
            with self.assertRaises(contracts.Rejected):
                automatic.policy(self.runtime, release)
        self.policy_path.chmod(0o600)
        self.policy_path.write_text(json.dumps(policy))
        self.policy_path.chmod(0o666)
        with self.assertRaises(contracts.Rejected):
            automatic.policy(self.runtime, release)
        self.policy_path.chmod(0o400)
        os.chown(self.policy_path, 1000, 1000)
        with self.assertRaises(contracts.Rejected):
            automatic.policy(self.runtime, release)

    def test_unknown_writer_or_database_blocks_before_stopping_services(self) -> None:
        self.runtime.inventory = lambda: [{"name": "/unrecognized-writer", "running": True}]
        with self.assertRaises(contracts.Rejected):
            automatic.deploy(self.state, self.runtime, self.source, self.delegation)
        self.assertFalse(any(command.startswith("docker stop") for command in self.runtime.commands))
        self.assertIsNone(self.state.load())
        self.runtime.inventory = lambda: []
        self.runtime.value["databaseIdentity"]["databaseName"] = "other-database"
        with self.assertRaises(contracts.Rejected):
            automatic.deploy(self.state, self.runtime, self.source, self.delegation)
        self.assertIsNone(self.state.load())

    def command_fixture(self) -> CommandFixture:
        root = self.root.parent / "ingress"
        root.mkdir(mode=0o700)
        fixture = CommandFixture(root)
        for service, image in fixture.release["images"].items():
            fixture.release["images"][service] = image.replace(f"ghcr.io/example/{service}", f"ghcr.io/example/project-{service}")
        policy = {"version": 1, "repository": "example/project", "databaseName": "labeling",
            "consumerSha256": fingerprint(Path(fixture.environment["LABELER_OBSERVER_ASSETS_ROOT"]))["sha256"],
            "backupRequired": False, "allowHistoricalCutover": True, "legacyIngressDisabled": True}
        policy_path = root / "automatic-deployment.json"
        policy_path.write_text(json.dumps(policy))
        policy_path.chmod(0o400)
        (fixture.bin / "backup").unlink()
        return fixture

    def test_forced_ssh_ingress_initializes_without_backup_executable_or_authorization_file(self) -> None:
        fixture = self.command_fixture()
        result = fixture.run("deploy " + fixture.release["releaseId"], archive(fixture.release).getvalue())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(b"DEPLOY_VPS_SUCCEEDED deploy", result.stdout)
        state = State(fixture.deploy_root)
        self.assertEqual(state.load()[1]["phase"], "completed")
        self.assertIsNone(state.load()[1]["backupRef"])
        self.assertNotIn("\nbackup\n", fixture.commands())

    def test_explicit_reconciliation_continues_automatic_release_without_backup(self) -> None:
        fixture = self.command_fixture()
        action = "deploy " + fixture.release["releaseId"]
        payload = archive(fixture.release).getvalue()
        self.assertNotEqual(fixture.run(action, payload, failure="prepare").returncode, 0)
        self.assertNotEqual(fixture.run(action, payload).returncode, 0)
        reconciled = fixture.run("reconcile")
        self.assertEqual(reconciled.returncode, 0, reconciled.stderr)
        continued = fixture.run("continue")
        self.assertEqual(continued.returncode, 0, continued.stderr)
        self.assertEqual(State(fixture.deploy_root).load()[1]["phase"], "completed")
        self.assertNotIn("\nbackup\n", fixture.commands())


if __name__ == "__main__":
    unittest.main()
