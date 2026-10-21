import json
import os
import tempfile
import unittest
import subprocess
import sys
from pathlib import Path

from host_fixture import archive, historical, candidate
from host_command_fixture import CommandFixture
import contracts


class ControllerCommands(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.fixture = CommandFixture(Path(self.temporary.name))

    def adopt(self):
        self.fixture.write_authorization("adopt")
        result = self.fixture.run("adopt")
        self.assertEqual(result.returncode, 0, result.stderr)

    def deploy(self, failure=""):
        self.fixture.write_authorization("deploy", self.fixture.binding)
        return self.fixture.run("deploy " + self.fixture.release["releaseId"], archive(self.fixture.release).getvalue(), failure)

    def test_complete_ingress_orders_images_backup_pending_prepare_runtime_smoke_publication(self):
        self.adopt()
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = self.fixture.commands()
        self.assertLess(commands.index("--network none --read-only"), commands.index("backup\n"))
        self.assertLess(commands.index("backup\n"), commands.index("up -d --no-build --no-deps --wait labeling-database"))
        self.assertLess(commands.index("run --rm --no-deps labeling-study-prepare"), commands.index("up -d --no-build --no-deps --wait labeling-server labeling-caddy"))
        self.assertEqual(os.readlink(self.fixture.deploy_root / "current"), "releases/" + self.fixture.release["releaseId"])
        journal = contracts.read(self.fixture.deploy_root / "state/database-compatibility.json")
        self.assertEqual(journal["status"], "verified")
        receipt = contracts.read(self.fixture.deploy_root / journal["evidenceRef"])
        self.assertEqual(receipt["phase"], "completed")
        self.assertEqual(sorted(path.name for path in (self.fixture.deploy_root / "current").resolve().iterdir()), sorted(contracts.FILES))

    def test_image_and_config_rejections_leave_no_installed_candidate_floor_or_changed_journal(self):
        self.adopt()
        before = (self.fixture.deploy_root / "state/database-compatibility.json").read_bytes()
        for failure in ("config", "digest", "revision", "hash-0", "hash-1", "hash-2", "hash-3"):
            result = self.deploy(failure)
            self.assertNotEqual(result.returncode, 0, failure)
            self.assertEqual((self.fixture.deploy_root / "state/database-compatibility.json").read_bytes(), before)
            self.assertFalse((self.fixture.deploy_root / "state/highest-generation").exists())
            self.assertEqual(list((self.fixture.deploy_root / "releases").iterdir()), [])
            attempts = list((self.fixture.deploy_root / "evidence" / self.fixture.release["releaseId"]).glob("attempt-*/result"))
            self.assertTrue(attempts and all(path.read_text().startswith("FAILED ") for path in attempts))
        self.assertNotIn("backup\n", self.fixture.commands())
        self.assertNotIn("up ", self.fixture.commands())

    def test_failed_backup_or_marker_never_starts_database_or_installs_candidate(self):
        self.adopt()
        for failure in ("backup", "marker"):
            result = self.deploy(failure)
            self.assertNotEqual(result.returncode, 0, failure)
            self.assertFalse((self.fixture.deploy_root / "state/highest-generation").exists())
        self.assertNotIn("up ", self.fixture.commands())

    def test_prepare_failure_blocks_runtime_and_requires_reconcile_not_generic_retry(self):
        self.adopt()
        result = self.deploy("prepare")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("--wait labeling-server", self.fixture.commands())
        journal = contracts.read(self.fixture.deploy_root / "state/database-compatibility.json")
        self.assertEqual(journal["status"], "pending")
        self.assertEqual((self.fixture.deploy_root / "state/highest-generation").read_text(), "1\n")
        self.assertNotEqual(self.deploy().returncode, 0)

    def test_late_first_v2_failure_never_activates_historical_v1(self):
        baseline = self.fixture.deploy_root / "releases" / historical()["releaseId"]
        baseline.mkdir(parents=True)
        raw = json.dumps(historical(), indent=4).encode()
        (baseline / "release-manifest.json").write_bytes(raw)
        os.symlink("releases/" + baseline.name, self.fixture.deploy_root / "current")
        self.adopt()
        result = self.deploy("runtime")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(os.readlink(self.fixture.deploy_root / "current"), "releases/" + baseline.name)
        self.assertEqual((baseline / "release-manifest.json").read_bytes(), raw)
        self.assertNotIn("-f " + str(baseline / "docker-compose.yml"), self.fixture.commands())

    def test_forced_ssh_rejects_nonallowlisted_commands_and_extra_spacing(self):
        for command in ("adopt", "continue", "reconcile", "deploy  " + self.fixture.release["releaseId"], "rollback; id"):
            result = self.fixture.run(command if command.startswith("deploy") or command.startswith("rollback") else "deploy " + command)
            self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.fixture.commands(), "")

    def test_compose_warning_does_not_corrupt_configuration_when_rendered(self):
        self.adopt()
        self.fixture.environment["SPY_WARNING"] = "1"
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(b"version is obsolete", result.stdout)
        [attempt] = (self.fixture.deploy_root / "evidence" / self.fixture.release["releaseId"]).glob("attempt-*")
        self.assertEqual(json.loads((attempt / "compose-config.json").read_text())["name"], "labeling")
        self.assertIn("version is obsolete", (attempt / "compose-config.log").read_text())

    def test_inline_configuration_secret_fails_before_docker_or_backup(self):
        (self.fixture.root / "production.env").write_text("PGPASSWORD=forbidden\n")
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"forbidden inline secret", result.stderr)
        self.assertEqual(self.fixture.commands(), "")

    def test_stale_generation_replay_never_changes_completed_publication(self):
        self.adopt()
        self.assertEqual(self.deploy().returncode, 0)
        before = (self.fixture.deploy_root / "state/database-compatibility.json").read_bytes()
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.fixture.deploy_root / "state/database-compatibility.json").read_bytes(), before)

    def test_wrong_project_or_external_profile_mount_fails_without_state_changes(self):
        self.adopt()
        config_path = self.fixture.root / "compose.json"
        original = config_path.read_bytes()
        before = (self.fixture.deploy_root / "state/database-compatibility.json").read_bytes()
        for failure in ("project", "writable", "missing", "leak"):
            value = json.loads(original)
            mounts = value["services"]["labeling-study-prepare"]["volumes"]
            if failure == "project":
                value["name"] = "another-project"
            elif failure == "writable":
                mounts[0]["read_only"] = False
            elif failure == "missing":
                mounts[0]["source"] = "/does-not-exist"
            else:
                value["services"]["labeling-server"]["volumes"].append(mounts[0])
            config_path.write_text(json.dumps(value))
            self.assertNotEqual(self.deploy().returncode, 0)
            self.assertEqual((self.fixture.deploy_root / "state/database-compatibility.json").read_bytes(), before)
        self.assertNotIn("backup\n", self.fixture.commands())

    def second_release(self):
        first_binding = self.fixture.binding
        self.fixture.directory, self.fixture.release, self.fixture.binding = candidate(self.fixture.root, 2)
        self.assertEqual(self.deploy().returncode, 0)
        return first_binding

    def test_runtime_failure_attempts_only_compatible_v2_restore_and_remains_failed(self):
        self.adopt()
        self.assertEqual(self.deploy().returncode, 0)
        active = os.readlink(self.fixture.deploy_root / "current")
        self.fixture.directory, self.fixture.release, self.fixture.binding = candidate(self.fixture.root, 2)
        result = self.deploy("runtime")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(os.readlink(self.fixture.deploy_root / "current"), active)
        previous_compose = str(self.fixture.deploy_root / active / "docker-compose.yml")
        self.assertIn("-f " + previous_compose + " up -d --no-build --no-deps --wait labeling-server labeling-caddy", self.fixture.commands())

    def test_retry_retained_caddyfile_is_readable_without_repeating_prepare(self):
        self.adopt()
        self.assertNotEqual(self.deploy("runtime").returncode, 0)
        caddy = self.fixture.deploy_root / "releases" / self.fixture.release["releaseId"] / "Caddyfile"
        caddy.chmod(0o600)
        self.fixture.write_authorization("reconcile", self.fixture.binding)
        result = self.fixture.run("reconcile")
        self.assertEqual(result.returncode, 0, result.stderr)
        prepare_count = self.fixture.commands().count("run --rm --no-deps labeling-study-prepare")
        self.fixture.write_authorization("continue", self.fixture.binding)
        result = self.fixture.run("continue")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(caddy.stat().st_mode & 0o777, 0o444)
        self.assertEqual(self.fixture.commands().count("run --rm --no-deps labeling-study-prepare"), prepare_count)

    def test_rollback_checks_both_axes_and_preserves_floor_without_database_commands(self):
        self.adopt()
        self.assertEqual(self.deploy().returncode, 0)
        first = self.second_release()
        self.fixture.write_authorization("rollback", first)
        (self.fixture.root / "commands.log").write_text("")
        result = self.fixture.run("rollback")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(forbidden in self.fixture.commands() for forbidden in ("labeling-study-prepare", "--wait labeling-database", "down")))
        self.assertEqual(((self.fixture.deploy_root / "state/highest-generation").read_text(), os.readlink(self.fixture.deploy_root / "current")),
            ("2\n", "releases/" + first["releaseId"]))
        self.assertEqual(contracts.read(self.fixture.deploy_root / contracts.read(self.fixture.deploy_root / "state/database-compatibility.json")["evidenceRef"])["phase"], "completed")
        historical_root = self.fixture.deploy_root / "releases" / historical()["releaseId"]
        historical_root.mkdir()
        (historical_root / "release-manifest.json").write_text(json.dumps(historical()))
        from state import State
        import durable
        import publication
        state = State(self.fixture.deploy_root)
        journal, receipt = state.load()
        durable.link(self.fixture.deploy_root, "previous", "releases/" + historical_root.name)
        receipt["publication"]["desired"] = publication.snapshot(self.fixture.deploy_root)
        deployment = receipt["publication"]["desired"]["deployment"]
        deployment = deployment.replace("previous=" + self.fixture.release["releaseId"], "previous=" + historical_root.name)
        receipt["publication"]["desired"]["deployment"] = deployment
        durable.write(self.fixture.deploy_root / "state/deployment", (deployment + "\n").encode())
        state.save(receipt, "verified")
        (self.fixture.root / "commands.log").write_text("")
        self.assertNotEqual(self.fixture.run("rollback").returncode, 0)
        self.assertNotIn(" up ", self.fixture.commands())

    def test_failed_rollback_never_reports_success_or_reduces_floor(self):
        self.adopt()
        self.assertEqual(self.deploy().returncode, 0)
        first = self.second_release()
        self.fixture.write_authorization("rollback", first)
        (self.fixture.root / "commands.log").write_text("")
        result = self.fixture.run("rollback", failure="runtime")
        self.assertTrue(result.returncode != 0 and b"SUCCEEDED" not in result.stdout)
        self.assertEqual((os.readlink(self.fixture.deploy_root / "current"), (self.fixture.deploy_root / "state/highest-generation").read_text()),
            ("releases/" + self.fixture.release["releaseId"], "2\n"))
        journal = contracts.read(self.fixture.deploy_root / "state/database-compatibility.json")
        self.assertEqual((journal["generation"], contracts.read(self.fixture.deploy_root / journal["evidenceRef"])["phase"]),
            (first["generation"], "cutover_verified"))
        self.assertNotIn("labeling-study-prepare", self.fixture.commands())

    def test_common_flock_serializes_competitors_and_older_loser_never_installs(self):
        self.adopt()
        code = "import sys;from pathlib import Path;sys.path.insert(0,sys.argv[2]);import durable;root=Path(sys.argv[1]);\nwith durable.lock(root):\n durable.write(root/'state/highest-generation',b'2\\n');print('locked',flush=True);sys.stdin.readline()"
        child = subprocess.Popen([sys.executable, "-B", "-c", code, str(self.fixture.deploy_root),
            str(Path(__file__).resolve().parents[1] / "deployment/host")], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        try:
            self.assertEqual(child.stdout.readline(), b"locked\n")
            self.fixture.write_authorization("deploy", self.fixture.binding)
            environment = {**self.fixture.environment, "SSH_ORIGINAL_COMMAND": "deploy " + self.fixture.release["releaseId"]}
            loser = subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve().parents[1] / "deployment/host/control.py")],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment)
            child.communicate(b"release\n", timeout=10)
            _stdout, stderr = loser.communicate(archive(self.fixture.release).getvalue(), timeout=20)
            self.assertNotEqual(loser.returncode, 0, stderr)
            self.assertEqual(list((self.fixture.deploy_root / "releases").iterdir()), [])
            self.assertEqual((self.fixture.deploy_root / "state/highest-generation").read_text(), "2\n")
        finally:
            if child.poll() is None:
                child.kill()
                child.communicate()


if __name__ == "__main__":
    unittest.main()
