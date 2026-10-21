import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from host_fixture import FakeRuntime, adopted, auth, candidate, observed
from host_normalization_fixture import loaded, normalization_fixture, normalize
import contracts
import durable
import lifecycle
import publication
import recovery
from state import State


class NormalizationRecovery(unittest.TestCase):
    def test_committed015_reconcile_stops_at_checkpoint_for_every_data_origin(self):
        for bundle in ("empty", "legacy300-v1", "copilot369-v1"):
            with tempfile.TemporaryDirectory() as temporary, self.subTest(bundle=bundle):
                fixture = normalization_fixture(Path(temporary), bundle)
                before = publication.snapshot(fixture.deploy_root)
                self.assertNotEqual(normalize(fixture, "post-commit").returncode, 0)
                self.assertEqual(loaded(fixture)[1]["phase"], "pending")
                fixture.write_authorization("reconcile", fixture.binding)
                (fixture.root / "commands.log").write_text("")
                result = fixture.run("reconcile")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(loaded(fixture)[1]["phase"], "normalization_verified")
                self.assertEqual(loaded(fixture)[1]["authorization"]["action"], "reconcile")
                self.assertEqual(publication.snapshot(fixture.deploy_root), before)
                self.assertNotIn(" up ", fixture.commands())
                self.assertNotIn("normalize-retired", fixture.commands())
                self.assertNotIn("labeling-study-prepare", fixture.commands())
                fixture.write_authorization("reconcile", fixture.binding)
                self.assertEqual(fixture.run("reconcile").returncode, 0)
                self.assertEqual(loaded(fixture)[1]["phase"], "normalization_verified")
                self.assertNotEqual(fixture.run("continue").returncode, 0)

    def test_catalog_without015_does_not_prove_commit_and_partial_state_blocks(self):
        for state in ("source", "canonical-no-ledger", "drift"):
            with tempfile.TemporaryDirectory() as temporary, self.subTest(state=state):
                fixture = normalization_fixture(Path(temporary), "copilot369-v1")
                self.assertNotEqual(normalize(fixture, "normalization").returncode, 0)
                value = copy.deepcopy(fixture.origin)
                if state == "canonical-no-ledger":
                    value.update(schema=contracts.SCHEMA, schemaFingerprint="a" * 64)
                if state == "drift":
                    value["fingerprint"] = "f" * 64
                (fixture.root / "observation.json").write_text(json.dumps(value))
                fixture.write_authorization("reconcile", fixture.binding)
                self.assertEqual(fixture.run("reconcile").returncode, 0)
                journal, receipt = loaded(fixture)
                self.assertEqual(receipt["phase"], "abandoned" if state == "source" else "unknown")
                self.assertEqual(journal["status"], "pending" if state == "source" else "unknown")
                fixture.write_authorization("continue", fixture.binding)
                self.assertNotEqual(fixture.run("continue").returncode, 0)
                self.assertNotIn(" up ", fixture.commands())

    def test_intact_source_requires_fresh_normalization_scope_and_reuses_reservation(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = normalization_fixture(Path(temporary))
            self.assertNotEqual(normalize(fixture, "normalization").returncode, 0)
            original = loaded(fixture)[1]
            floor = fixture.deploy_root / "state/highest-generation"
            inode = floor.stat().st_ino
            fixture.write_authorization("reconcile", fixture.binding)
            self.assertEqual(fixture.run("reconcile").returncode, 0)
            result = normalize(fixture)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(loaded(fixture)[1]["operationId"], original["operationId"])
            self.assertEqual(floor.stat().st_ino, inode)

    def test_already015_normalization_is_readonly_but_still_stops_and_keeps_reserve(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = normalization_fixture(Path(temporary), "copilot369-v1", contracts.SCHEMA)
            (fixture.root / "applied015").touch()
            result = normalize(fixture)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(loaded(fixture)[1]["phase"], "normalization_verified")
            self.assertNotIn("normalize-retired-study-schema.js", fixture.commands())
            self.assertNotIn(" up ", fixture.commands())

    def test_checkpoint_receipt_fsync_failure_can_only_be_recovered_readonly(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = State(root)
            origin = observed("copilot369-v1", contracts.SCHEMA)
            adopted(state, origin)
            directory, _, _ = candidate(root)
            runtime = FakeRuntime(root, origin)
            original_write = durable.write
            def interrupted(path, payload, immutable=False):
                if b'"phase":"normalization_verified"' in payload:
                    raise OSError("injected checkpoint receipt failure")
                original_write(path, payload, immutable)
            with patch("authority.authorize", return_value=auth("maintenance-normalize")), patch("authority.backup", return_value={"path": "/external/receipt", "sha256": "f" * 64}), patch("durable.write", interrupted):
                with self.assertRaises(OSError):
                    lifecycle.deploy(state, runtime, directory, "maintenance-normalize")
            self.assertEqual(state.load()[1]["phase"], "pending")
            runtime.commands.clear()
            with patch("authority.authorize", return_value=auth("reconcile")):
                recovery.reconcile(state, runtime)
            self.assertEqual(state.load()[1]["phase"], "normalization_verified")
            self.assertNotIn("normalize", runtime.commands)
            self.assertNotIn("up labeling-server labeling-caddy", runtime.commands)

    def test_normalized_historical_continuation_calls_existing_maintenance_and_preserves_origin(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = normalization_fixture(Path(temporary), "legacy300-v1")
            self.assertEqual(normalize(fixture).returncode, 0)
            state = State(fixture.deploy_root)
            _, checkpoint = state.load()
            runtime = FakeRuntime(fixture.deploy_root, checkpoint["target"]["observation"])
            runtime.applied015 = True
            authorization = {**auth("continue"), "requestSha256": "e" * 64}
            baseline = checkpoint["target"]["observation"]
            with patch("authority.authorize", return_value=authorization), patch("authority.backup", return_value={"path": "/external/post015", "sha256": "f" * 64}) as backup:
                lifecycle.continue_operation(state, runtime, "continue")
            self.assertEqual(backup.call_args.args[1], baseline)
            self.assertEqual(state.load()[1]["phase"], "cutover_verified")
            self.assertEqual(state.load()[1]["origin"], checkpoint["origin"])
            self.assertEqual(runtime.commands.count("cutover"), 1)
            self.assertNotIn("normalize", runtime.commands)
            self.assertNotIn("up labeling-server labeling-caddy", runtime.commands)


if __name__ == "__main__":
    unittest.main()
