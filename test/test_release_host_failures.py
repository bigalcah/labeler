import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from host_command_fixture import CommandFixture
from host_fixture import FakeRuntime, adopted, archive, auth, candidate, historical, observed
import durable
import contracts
import lifecycle
import publication
import recovery
from state import State


class LateFailureRecovery(unittest.TestCase):
    def test_first_v2_smoke_failure_requires_reconcile_and_continues_without_data_rewrites(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = CommandFixture(Path(temporary))
            legacy = historical()
            baseline = fixture.deploy_root / "releases" / legacy["releaseId"]
            baseline.mkdir(parents=True)
            raw = json.dumps(legacy, indent=4).encode()
            (baseline / "release-manifest.json").write_bytes(raw)
            os.symlink("releases/" + baseline.name, fixture.deploy_root / "current")
            fixture.write_authorization("adopt")
            self.assertEqual(fixture.run("adopt").returncode, 0)
            fixture.write_authorization("deploy", fixture.binding)
            failed = fixture.run("deploy " + fixture.release["releaseId"], archive(fixture.release).getvalue(), "smoke")
            self.assertNotEqual(failed.returncode, 0)
            self.assertEqual(os.readlink(fixture.deploy_root / "current"), "releases/" + baseline.name)
            self.assertEqual((baseline / "release-manifest.json").read_bytes(), raw)
            self.assertNotIn("-f " + str(baseline / "docker-compose.yml"), fixture.commands())
            journal = contracts.read(fixture.deploy_root / "state/database-compatibility.json")
            self.assertEqual(contracts.read(fixture.deploy_root / journal["evidenceRef"])["phase"], "runtime_verified")
            self.assertEqual((fixture.deploy_root / "state/highest-generation").read_text(), "1\n")
            count = fixture.commands().count("run --rm --no-deps labeling-study-prepare")
            fixture.write_authorization("reconcile", fixture.binding)
            result = fixture.run("reconcile")
            self.assertEqual(result.returncode, 0, result.stderr)
            fixture.write_authorization("continue", fixture.binding)
            result = fixture.run("continue")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(fixture.commands().count("run --rm --no-deps labeling-study-prepare"), count)
            self.assertEqual(os.readlink(fixture.deploy_root / "current"), "releases/" + fixture.release["releaseId"])

    def test_crashed_reservation_floor_is_repaired_and_exact_equal_generation_continues(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            origin = observed()
            state = State(root)
            adopted(state, origin)
            directory, _release, binding = candidate(root)
            lifecycle.install(state, directory, binding)
            original_write = durable.write

            def interrupted(path, payload, immutable=False):
                if path.name == "highest-generation":
                    raise OSError("synthetic floor crash")
                original_write(path, payload, immutable)

            with patch("durable.write", interrupted), self.assertRaises(OSError):
                state.reserve(binding, origin, auth())
            journal, reserved = state.load()
            self.assertEqual((journal["status"], reserved["phase"], state.floor()), ("pending", "reserved", -1))
            before_publication = publication.snapshot(root)
            runtime = FakeRuntime(root, origin)
            with patch("authority.authorize", return_value=auth("reconcile")):
                recovery.reconcile(state, runtime)
            journal, abandoned = state.load()
            self.assertEqual((journal["status"], abandoned["phase"]), ("pending", "abandoned"))
            self.assertEqual((abandoned["operationId"], abandoned["candidate"]), (reserved["operationId"], binding))
            self.assertEqual(state.floor(), binding["generation"])
            self.assertEqual(publication.snapshot(root), before_publication)
            self.assertEqual(runtime.commands, ["config", "observe", "inventory"])
            runtime.commands.clear()
            with patch("authority.authorize", return_value=auth("continue")), patch("authority.backup", return_value={"path": "/external/backup", "sha256": "f" * 64}):
                lifecycle.continue_operation(state, runtime, "continue")
            journal, completed = state.load()
            self.assertEqual((journal["status"], completed["phase"]), ("verified", "completed"))
            self.assertEqual((completed["operationId"], completed["candidate"]), (reserved["operationId"], binding))
            self.assertEqual(state.floor(), binding["generation"])
            self.assertEqual(publication.snapshot(root), completed["publication"]["desired"])
            self.assertEqual(sum("labeling-study-prepare" in command for command in runtime.commands), 1)

    def test_same_generation_authorization_rejects_changed_attempt_candidate_images_hashes_or_database(self):
        mutations = (
            ("attempt", lambda authorization, binding: authorization["candidate"].update(
                releaseId=binding["releaseId"].replace("-1-", "-2-", 1))),
            ("candidate", lambda authorization, _binding: authorization["candidate"].update(commit="e" * 40)),
            ("image", lambda authorization, binding: authorization["candidate"]["images"].update(
                server=binding["images"]["server"].rsplit("@sha256:", 1)[0] + "@sha256:" + "c" * 64)),
            ("package-hash", lambda authorization, _binding: authorization["candidate"]["packageHashes"].update(Caddyfile="f" * 64)),
            ("database", lambda authorization, _binding: authorization["databaseIdentity"].update(databaseOid="99999")),
        )
        for name, mutate in mutations:
            with tempfile.TemporaryDirectory() as temporary, self.subTest(binding=name):
                fixture = CommandFixture(Path(temporary))
                fixture.write_authorization("adopt")
                self.assertEqual(fixture.run("adopt").returncode, 0)
                before_journal = (fixture.deploy_root / "state/database-compatibility.json").read_bytes()
                before_publication = publication.snapshot(fixture.deploy_root)
                before_commands = fixture.commands()
                fixture.write_authorization("deploy", fixture.binding)
                authorization_path = fixture.root / "authorization.json"
                authorization = json.loads(authorization_path.read_text())
                mutate(authorization, fixture.binding)
                authorization_path.write_text(json.dumps(authorization))
                result = fixture.run("deploy " + fixture.release["releaseId"], archive(fixture.release).getvalue())
                self.assertNotEqual(result.returncode, 0, name)
                self.assertEqual((fixture.deploy_root / "state/database-compatibility.json").read_bytes(), before_journal)
                self.assertEqual(publication.snapshot(fixture.deploy_root), before_publication)
                self.assertFalse((fixture.deploy_root / "state/highest-generation").exists())
                self.assertEqual(list((fixture.deploy_root / "releases").iterdir()), [])
                self.assertEqual(fixture.commands(), before_commands)

    def test_completed_state_rejects_pointer_floor_and_metadata_conflicts_without_repair(self):
        mutations = (
            ("pointer", lambda root: durable.link(root, "current", "releases/0-1-" + "0" * 40)),
            ("floor", lambda root: durable.write(root / "state/highest-generation", b"0\n")),
            ("metadata", lambda root: durable.write(root / "state/deployment",
                (root / "state/deployment").read_text().replace("generation=1", "generation=0").encode())),
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = State(root)
            origin = observed()
            adopted(state, origin)
            directory, _release, binding = candidate(root)
            lifecycle.install(state, directory, binding)
            receipt = state.reserve(binding, origin, auth())
            receipt = state.advance(receipt, "pending")
            target = observed(contracts.BUNDLE, contracts.SCHEMA)
            receipt = lifecycle.verified(state, receipt, target)
            lifecycle.finish(state, FakeRuntime(root, target), receipt)
            for name, mutate in mutations:
                with tempfile.TemporaryDirectory() as temporary, self.subTest(conflict=name):
                    clone = Path(temporary) / "host"
                    shutil.copytree(root, clone, symlinks=True)
                    state = State(clone)
                    mutate(clone)
                    before = (state.path.read_bytes(), (clone / "state/highest-generation").read_bytes(), publication.snapshot(clone))
                    with self.assertRaises(contracts.Rejected):
                        state.load()
                    self.assertEqual((state.path.read_bytes(), (clone / "state/highest-generation").read_bytes(), publication.snapshot(clone)), before)


if __name__ == "__main__":
    unittest.main()
