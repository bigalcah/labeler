import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from host_command_fixture import CommandFixture
from host_fixture import observed
import authority
import contracts
from runtime import Runtime


class BackupBoundary(unittest.TestCase):
    def test_full_custom_restore_receipt_accepts_empty_and_known_001_origins(self):
        for schema in ("empty", "001_study_foundation"):
            with tempfile.TemporaryDirectory() as temporary:
                fixture = CommandFixture(Path(temporary))
                fixture.origin = observed("empty", schema)
                (fixture.root / "observation.json").write_text(json.dumps(fixture.origin))
                fixture.write_backup()
                with patch.dict(os.environ, fixture.environment, clear=True):
                    runtime = Runtime(fixture.deploy_root)
                    receipt = authority.backup(runtime, fixture.origin)
                self.assertEqual(receipt["path"], str(fixture.root / "backup.json"))
                self.assertEqual(len(receipt["sha256"]), 64)
                self.assertNotIn(" up ", fixture.commands())

    def test_backup_rejects_unknown_fields_wrong_bindings_and_incomplete_or_in_place_restore(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = CommandFixture(Path(temporary))
            receipt_path = fixture.root / "backup.json"
            original = json.loads(receipt_path.read_text())
            changes = [lambda value: value.update(version=True), lambda value: value.update(extra=True),
                lambda value: value["archive"].update(format="plain"), lambda value: value["archive"].update(scope="study-only"),
                lambda value: value["archive"].update(sha256="0" * 64), lambda value: value.update(writersStopped=False),
                lambda value: value["databaseIdentity"].update(databaseOid="999"),
                lambda value: value["restore"].update(databaseIdentity=fixture.origin["databaseIdentity"]),
                lambda value: value["restore"].update(result="attempted"),
                lambda value: value["restore"].update(dataFingerprint="0" * 64),
                lambda value: value["prerequisites"].pop("roles"),
                lambda value: value["origin"].update(schema="001_study_foundation")]
            for change in changes:
                value = copy.deepcopy(original)
                change(value)
                receipt_path.write_text(json.dumps(value))
                with patch.dict(os.environ, fixture.environment, clear=True):
                    runtime = Runtime(fixture.deploy_root)
                    with self.assertRaises(contracts.Rejected):
                        authority.backup(runtime, fixture.origin)
            self.assertNotIn(" up ", fixture.commands())


if __name__ == "__main__":
    unittest.main()
