import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from host_fixture import FakeRuntime, adopted, auth, candidate, historical, observed
import contracts
import lifecycle
import publication
import recovery
from state import State


class MaintenanceBridge(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state = State(self.root)
        baseline = historical()
        directory = self.root / "releases" / baseline["releaseId"]
        directory.mkdir()
        (directory / "release-manifest.json").write_text(json.dumps(baseline))
        for name in ("current", "previous"):
            os.symlink("releases/" + baseline["releaseId"], self.root / name)
        self.origin = observed("legacy300-v1", contracts.SCHEMA)
        receipt = adopted(self.state, self.origin)
        before = publication.snapshot(self.root)
        self.state.save({**receipt, "publication": {"before": before, "desired": before}}, "verified")
        self.directory, self.release, self.binding = candidate(self.root, 10)

    def test_exact_maintenance_bridge_continues_same_candidate_without_repeating_cutover_or_prepare(self):
        runtime = FakeRuntime(self.root, self.origin)
        with patch("authority.authorize", return_value=auth("maintenance")), patch("authority.backup", return_value={"path": "/external/origin-receipt", "sha256": "f" * 64}):
            lifecycle.deploy(self.state, runtime, self.directory, "maintenance")
        journal, receipt = self.state.load()
        self.assertEqual(journal["status"], "verified")
        self.assertEqual(receipt["phase"], "cutover_verified")
        self.assertEqual(self.state.floor(), 10)
        self.assertNotIn("up labeling-server labeling-caddy", runtime.commands)
        with patch("authority.authorize", return_value=auth("deploy")):
            lifecycle.deploy(self.state, runtime, self.directory, "deploy")
        self.assertEqual(self.state.load()[1]["phase"], "completed")
        self.assertEqual(runtime.commands.count("cutover"), 1)
        self.assertFalse(any("labeling-study-prepare" in command for command in runtime.commands))
        self.assertEqual(self.state.load()[1]["backupRef"]["path"], "/external/origin-receipt")

    def test_interrupted_cutover_blocks_deploy_and_reconcile_never_executes_cutover(self):
        runtime = FakeRuntime(self.root, self.origin)
        runtime.failure = "cutover"
        with patch("authority.authorize", return_value=auth("maintenance")), patch("authority.backup", return_value={"path": "/external/origin-receipt", "sha256": "f" * 64}):
            with self.assertRaises(contracts.Rejected):
                lifecycle.deploy(self.state, runtime, self.directory, "maintenance")
        self.assertEqual(self.state.load()[0]["status"], "pending")
        count = runtime.commands.count("cutover")
        with patch("authority.authorize", return_value=auth("deploy")), self.assertRaises(contracts.Rejected):
            lifecycle.deploy(self.state, runtime, self.directory, "deploy")
        runtime.failure = None
        with patch("authority.authorize", return_value=auth("reconcile")):
            recovery.reconcile(self.state, runtime)
        self.assertEqual(runtime.commands.count("cutover"), count)
        self.assertEqual(self.state.load()[1]["phase"], "abandoned")

    def test_changed_historical_manifest_is_rejected_before_backup_reservation_or_cutover(self):
        baseline = self.root / publication.snapshot(self.root)["current"] / "release-manifest.json"
        changed = json.loads(baseline.read_text())
        changed["images"]["server"] = changed["images"]["server"].split("@")[0] + "@sha256:" + "f" * 64
        baseline.write_text(json.dumps(changed))
        runtime = FakeRuntime(self.root, self.origin)
        with patch("authority.authorize", return_value=auth("maintenance")), patch("authority.backup") as backup:
            with self.assertRaises(contracts.Rejected):
                lifecycle.deploy(self.state, runtime, self.directory, "maintenance")
        backup.assert_not_called()
        self.assertEqual(self.state.floor(), -1)
        self.assertNotIn("cutover", runtime.commands)


if __name__ == "__main__":
    unittest.main()
