import json
import os
import tempfile
import unittest
from pathlib import Path

from host_fixture import archive
from host_normalization_fixture import loaded, normalization_fixture, normalize
import contracts
import publication


class NormalizationCommands(unittest.TestCase):
    def test_each_origin_stops_at_normalization_checkpoint_without_runtime_or_publication(self):
        for bundle in ("empty", "legacy300-v1", "copilot369-v1"):
            with tempfile.TemporaryDirectory() as temporary, self.subTest(bundle=bundle):
                fixture = normalization_fixture(Path(temporary), bundle)
                before = publication.snapshot(fixture.deploy_root)
                result = normalize(fixture)
                self.assertEqual(result.returncode, 0, result.stderr)
                journal, receipt = loaded(fixture)
                self.assertEqual((journal["status"], receipt["phase"]), ("verified", "normalization_verified"))
                self.assertEqual(journal["target"], {"schema": contracts.SCHEMA, "dataBundle": bundle})
                self.assertEqual(receipt["origin"], fixture.origin)
                self.assertEqual((len(journal), len(receipt)), (12, 12))
                self.assertEqual(publication.snapshot(fixture.deploy_root), before)
                self.assertEqual((fixture.deploy_root / "state/highest-generation").read_text(), "1\n")
                commands = fixture.commands()
                self.assertIn("scripts/normalize-retired-study-schema.js", commands)
                self.assertNotIn(" up ", commands)
                self.assertNotIn("scripts/cutover", commands)
                self.assertNotIn("scripts/migrate", commands)
                self.assertNotIn("--no-deps labeling-study-prepare", commands)
                self.assertLess(commands.index("backup\n"), commands.index("scripts/normalize-retired-study-schema.js"))
                [context] = (fixture.deploy_root / "runtime").glob("*/*/context.json")
                self.assertEqual((context.stat().st_uid, context.stat().st_gid, context.stat().st_mode & 0o777), (0, 1000, 0o440))
                self.assertEqual(context.parent.stat().st_mode & 0o777, 0o700)

    def test_fresh_continuation_initializes_empty_and_reads_copilot_without_new_reservation(self):
        for bundle in ("empty", "copilot369-v1"):
            with tempfile.TemporaryDirectory() as temporary, self.subTest(bundle=bundle):
                fixture = normalization_fixture(Path(temporary), bundle)
                self.assertEqual(normalize(fixture).returncode, 0)
                _, checkpoint = loaded(fixture)
                floor = fixture.deploy_root / "state/highest-generation"
                floor_identity = floor.stat().st_ino
                fixture.origin = contracts.read(fixture.root / "observation.json")
                fixture.write_backup()
                fixture.write_authorization("continue", fixture.binding)
                (fixture.root / "commands.log").write_text("")
                result = fixture.run("continue")
                self.assertEqual(result.returncode, 0, result.stderr)
                _, receipt = loaded(fixture)
                self.assertEqual(receipt["phase"], "completed")
                self.assertEqual(receipt["origin"], checkpoint["origin"])
                self.assertEqual(floor.stat().st_ino, floor_identity)
                self.assertNotIn("normalize-retired", fixture.commands())
                self.assertNotIn("migrate-study", fixture.commands())
                self.assertIn("--wait labeling-server labeling-caddy", fixture.commands())
                if bundle == "empty":
                    self.assertIn("backup\n", fixture.commands())
                    self.assertIn("--no-deps labeling-study-prepare", fixture.commands())
                else:
                    self.assertNotIn("backup\n", fixture.commands())
                    self.assertNotIn("labeling-study-prepare", fixture.commands())

    def test_pre015_backup_is_rejected_before_empty_continuation_sql(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = normalization_fixture(Path(temporary))
            self.assertEqual(normalize(fixture).returncode, 0)
            before = loaded(fixture)
            fixture.write_authorization("continue", fixture.binding)
            (fixture.root / "commands.log").write_text("")
            self.assertNotEqual(fixture.run("continue").returncode, 0)
            self.assertEqual(loaded(fixture), before)
            self.assertNotIn(" up ", fixture.commands())
            self.assertNotIn("--no-deps labeling-study-prepare", fixture.commands())

    def test_normalization_only_expired_missing_or_other_candidate_cannot_continue(self):
        for failure in ("normalization-only", "expired", "missing", "candidate"):
            with tempfile.TemporaryDirectory() as temporary, self.subTest(failure=failure):
                fixture = normalization_fixture(Path(temporary), "copilot369-v1")
                self.assertEqual(normalize(fixture).returncode, 0)
                before = loaded(fixture)
                if failure != "normalization-only":
                    fixture.write_authorization("continue", fixture.binding)
                path = fixture.root / "authorization.json"
                authorization = contracts.read(path)
                if failure == "expired":
                    authorization["expiresAt"] = "2020-01-01T00:00:00Z"
                if failure == "candidate":
                    authorization["candidate"]["images"]["server"] += "other"
                path.write_text(json.dumps(authorization))
                if failure == "missing":
                    path.unlink()
                (fixture.root / "commands.log").write_text("")
                self.assertNotEqual(fixture.run("continue").returncode, 0)
                self.assertEqual(loaded(fixture), before)
                self.assertNotIn(" up ", fixture.commands())

    def test_retired_origin_is_inventory_only_for_ordinary_deploy(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = normalization_fixture(Path(temporary), "copilot369-v1")
            fixture.write_authorization("deploy", fixture.binding)
            before = loaded(fixture)
            result = fixture.run("deploy " + fixture.release["releaseId"], archive(fixture.release).getvalue())
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(loaded(fixture), before)
            self.assertFalse((fixture.deploy_root / "state/highest-generation").exists())
            self.assertEqual(list((fixture.deploy_root / "releases").iterdir()), [])
            self.assertNotIn(" up ", fixture.commands())

    def test_source_pin_and_cutover_authorization_cannot_admit_normalization(self):
        for failure in ("normalization-source", "authorization"):
            with tempfile.TemporaryDirectory() as temporary, self.subTest(failure=failure):
                fixture = normalization_fixture(Path(temporary))
                before = loaded(fixture)
                fixture.write_authorization("maintenance" if failure == "authorization" else "maintenance-normalize", fixture.binding)
                result = fixture.run("maintenance normalize " + fixture.release["releaseId"], archive(fixture.release).getvalue(), failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(loaded(fixture), before)
                self.assertNotIn("backup\n", fixture.commands())
                self.assertNotIn("normalize-retired-study-schema.js", fixture.commands())

    def test_historical_continuation_uses_real_runtime_maintenance_entrypoints_then_exact_deploy_bridge(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = normalization_fixture(Path(temporary), "legacy300-v1")
            self.assertEqual(normalize(fixture).returncode, 0)
            _, checkpoint = loaded(fixture)
            fixture.origin = contracts.read(fixture.root / "observation.json")
            fixture.write_backup()
            request = fixture.root / "cutover-request.json"
            request.write_text(json.dumps({"confirmation": "cutover-primary-300-to-copilot-369", "database": {
                "host": "labeling-database", "port": 5432, "database": "labeling",
                "passwordFile": str(fixture.root / "inspection-password")}}))
            fixture.environment["LABELER_CUTOVER_REQUEST_FILE"] = str(request)
            fixture.write_authorization("continue", fixture.binding)
            (fixture.root / "commands.log").write_text("")
            result = fixture.run("continue")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(loaded(fixture)[1]["phase"], "cutover_verified")
            self.assertEqual(loaded(fixture)[1]["origin"], checkpoint["origin"])
            commands = fixture.commands()
            self.assertLess(commands.index("backup\n"), commands.index("scripts/migrate-study-schema.js"))
            self.assertLess(commands.index("scripts/migrate-study-schema.js"), commands.index("scripts/cutover-copilot-369.js"))
            self.assertNotIn("normalize-retired", commands)
            self.assertNotIn(" up ", commands)
            fixture.write_authorization("deploy", fixture.binding)
            (fixture.root / "commands.log").write_text("")
            result = fixture.run("deploy " + fixture.release["releaseId"], archive(fixture.release).getvalue())
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(loaded(fixture)[1]["phase"], "completed")
            self.assertNotIn("scripts/migrate-study", fixture.commands())
            self.assertNotIn("scripts/cutover", fixture.commands())


if __name__ == "__main__":
    unittest.main()
