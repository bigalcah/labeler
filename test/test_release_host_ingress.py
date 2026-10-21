import tempfile
import unittest
from pathlib import Path

from host_command_fixture import CommandFixture
from host_fixture import archive, historical


class HostileIngress(unittest.TestCase):
    def test_hostile_ingress_never_reaches_docker_or_active_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = CommandFixture(Path(temporary))
            for variant in ("traversal", "symlink", "hardlink", "duplicate", "extra", "v1"):
                payload = archive(historical() if variant == "v1" else fixture.release,
                                  "valid" if variant == "v1" else variant).getvalue()
                result = fixture.run("deploy " + fixture.release["releaseId"], payload)
                self.assertNotEqual(result.returncode, 0, variant)
                self.assertEqual(fixture.commands(), "")
                self.assertEqual(list((fixture.deploy_root / "releases").iterdir()), [])
                self.assertFalse((fixture.deploy_root / "state/database-compatibility.json").exists())
                self.assertFalse((fixture.deploy_root / "state/highest-generation").exists())
                self.assertFalse((fixture.deploy_root / "current").exists())

    def test_valid_package_without_matching_operator_approval_never_reaches_images_or_database(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = CommandFixture(Path(temporary))
            fixture.write_authorization("adopt")
            self.assertEqual(fixture.run("adopt").returncode, 0)
            before = (fixture.deploy_root / "state/database-compatibility.json").read_bytes()
            (fixture.root / "commands.log").write_text("")
            result = fixture.run("deploy " + fixture.release["releaseId"], archive(fixture.release).getvalue())
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(fixture.commands(), "")
            self.assertEqual((fixture.deploy_root / "state/database-compatibility.json").read_bytes(), before)
            self.assertEqual(list((fixture.deploy_root / "releases").iterdir()), [])
            self.assertFalse((fixture.deploy_root / "state/highest-generation").exists())


if __name__ == "__main__":
    unittest.main()
