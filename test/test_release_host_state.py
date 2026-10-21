import copy
import os
import tempfile
import unittest
import shutil
from pathlib import Path
from unittest.mock import patch

from host_fixture import FakeRuntime, adopted, auth, candidate, observed
import contracts
import durable
import lifecycle
import publication
import recovery
from state import State


class DurableState(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state = State(self.root)
        self.origin = observed()
        adopted(self.state, self.origin)
        self.directory, self.release, self.binding = candidate(self.root)

    def test_fsyncs_file_and_parent_when_receipt_then_journal_are_published(self):
        events = []
        original_sync = os.fsync
        original_replace = os.replace
        def synced(descriptor):
            events.append("directory-sync" if os.path.isdir(f"/proc/self/fd/{descriptor}") else "file-sync")
            original_sync(descriptor)
        def replaced(source, destination):
            events.append("journal-rename")
            original_replace(source, destination)
        with patch("os.fsync", synced), patch("os.replace", replaced):
            self.state.reserve(self.binding, self.origin, auth())
        self.assertEqual(events[-3:], ["file-sync", "journal-rename", "directory-sync"])
        self.assertGreaterEqual(events.count("file-sync"), 3)
        self.assertGreaterEqual(events.count("directory-sync"), 3)

    def test_reservation_survives_when_floor_write_crashes_and_blocks_replay(self):
        original = durable.write
        def interrupted(path, payload, immutable=False):
            if path.name == "highest-generation":
                raise OSError("synthetic crash")
            return original(path, payload, immutable)
        with patch("durable.write", interrupted), self.assertRaises(OSError):
            self.state.reserve(self.binding, self.origin, auth())
        self.assertEqual(self.state.floor(), -1)
        self.assertEqual(self.state.load()[1]["phase"], "reserved")
        with self.assertRaises(contracts.Rejected):
            self.state.reserve(self.binding, self.origin, auth())

    def test_pending_durability_failure_blocks_all_mutating_commands(self):
        runtime = FakeRuntime(self.root)
        original = self.state.save
        def interrupted(receipt, status):
            if receipt["phase"] == "pending":
                raise OSError("cannot fsync pending")
            return original(receipt, status)
        with patch("authority.authorize", return_value=auth()), patch("authority.backup", return_value={"path": "/synthetic/receipt", "sha256": "f" * 64}), patch.object(self.state, "save", interrupted), self.assertRaises(OSError):
            lifecycle.deploy(self.state, runtime, self.directory, "deploy")
        self.assertFalse(any(command.startswith("up ") or "run --rm" in command for command in runtime.commands))

    def test_unreferenced_receipt_cannot_authorize_when_journal_is_missing(self):
        before = self.state.path.read_bytes()
        self.state.path.unlink()
        self.assertIsNone(self.state.load())
        with self.assertRaises(contracts.Rejected):
            self.state.reserve(self.binding, self.origin, auth())
        self.assertGreater(len(before), 0)

    def test_unknown_malformed_and_mismatched_state_never_admits_a_new_reservation(self):
        original = self.state.path.read_bytes()
        for payload in (b"{}", b'{"formatVersion":1,"formatVersion":1}', b"not-json"):
            self.state.path.write_bytes(payload)
            with self.assertRaises(contracts.Rejected):
                self.state.reserve(self.binding, self.origin, auth())
        self.state.path.write_bytes(original)
        floor = self.root / "state/highest-generation"
        durable.write(floor, b"2\n")
        before = (self.state.path.read_bytes(), floor.read_bytes(), publication.snapshot(self.root))
        with self.assertRaises(contracts.Rejected):
            self.state.reserve(self.binding, self.origin, auth())
        self.assertEqual((self.state.path.read_bytes(), floor.read_bytes(), publication.snapshot(self.root)), before)
        durable.write(floor, b"0\n")
        other_database = copy.deepcopy(self.origin)
        other_database["databaseIdentity"]["databaseOid"] = "99999"
        with self.assertRaises(contracts.Rejected):
            self.state.reserve(self.binding, other_database, auth())
        receipt = self.state.reserve(self.binding, self.origin, auth())
        before = self.state.path.read_bytes()
        _directory, _release, later = candidate(self.root, 2)
        with self.assertRaises(contracts.Rejected):
            self.state.reserve(later, self.origin, auth())
        self.assertEqual(self.state.path.read_bytes(), before)

    def test_reconcile_only_observes_when_an_intact_origin_is_abandoned(self):
        receipt = self.state.reserve(self.binding, self.origin, auth())
        lifecycle.install(self.state, self.directory, self.binding)
        self.state.advance(receipt, "pending")
        before = publication.snapshot(self.root)
        runtime = FakeRuntime(self.root)
        with patch("authority.authorize", return_value=auth("reconcile")):
            recovery.reconcile(self.state, runtime)
        self.assertEqual(publication.snapshot(self.root), before)
        self.assertEqual(self.state.load()[1]["phase"], "abandoned")
        self.assertTrue(all(command in ("config", "observe", "inventory") for command in runtime.commands))

    def test_reconcile_target_prevents_repeating_prepare_when_destination_is_exact(self):
        receipt = self.state.reserve(self.binding, self.origin, auth())
        lifecycle.install(self.state, self.directory, self.binding)
        self.state.advance(receipt, "pending")
        runtime = FakeRuntime(self.root, observed(contracts.BUNDLE, contracts.SCHEMA))
        with patch("authority.authorize", return_value=auth("reconcile")):
            recovery.reconcile(self.state, runtime)
        self.assertEqual(self.state.load()[0]["status"], "verified")
        self.assertEqual(self.state.load()[1]["phase"], "cutover_verified")
        with patch("authority.authorize", return_value=auth("continue")):
            lifecycle.continue_operation(self.state, runtime, "continue")
        self.assertEqual(self.state.load()[1]["phase"], "completed")
        self.assertFalse(any("labeling-study-prepare" in command or command == "cutover" for command in runtime.commands))

    def test_unknown_observation_remains_blocked_when_reconcile_sees_drift(self):
        receipt = self.state.reserve(self.binding, self.origin, auth())
        lifecycle.install(self.state, self.directory, self.binding)
        self.state.advance(receipt, "pending")
        drifted = {**self.origin, "fingerprint": "f" * 64}
        with patch("authority.authorize", return_value=auth("reconcile")):
            recovery.reconcile(self.state, FakeRuntime(self.root, drifted))
        self.assertEqual(self.state.load()[0]["status"], "unknown")
        with self.assertRaises(contracts.Rejected):
            self.state.reserve(self.binding, drifted, auth())

    def test_publication_crash_requires_explicit_fresh_finalization(self):
        receipt = self.state.reserve(self.binding, self.origin, auth())
        lifecycle.install(self.state, self.directory, self.binding)
        receipt = self.state.advance(receipt, "pending")
        target = observed(contracts.BUNDLE, contracts.SCHEMA)
        receipt = lifecycle.verified(self.state, receipt, target)
        runtime = FakeRuntime(self.root, target)
        original = durable.write
        def interrupted(path, payload, immutable=False):
            if path.name == "active-schema-version":
                raise OSError("crash after current")
            return original(path, payload, immutable)
        with patch("durable.write", interrupted), self.assertRaises(OSError):
            lifecycle.finish(self.state, runtime, receipt)
        self.assertEqual(self.state.load()[1]["phase"], "publication_intent")
        before = publication.snapshot(self.root)
        with patch("authority.authorize", return_value=auth("reconcile")):
            recovery.reconcile(self.state, runtime)
        self.assertEqual(publication.snapshot(self.root), before)
        with patch("authority.authorize", return_value=auth("finalize-publication")):
            lifecycle.continue_operation(self.state, runtime, "finalize-publication")
        self.assertEqual(self.state.load()[1]["phase"], "completed")
        self.assertIn("check-runtime", runtime.commands)

    def test_root_owned_handoff_is_readable_only_by_mapped_group_when_own_pending_is_current(self):
        receipt = self.state.reserve(self.binding, self.origin, auth())
        receipt = self.state.advance(receipt, "pending")
        with patch("os.geteuid", return_value=0), patch("os.chown") as chown:
            if os.getuid() != 0:
                with self.assertRaises(contracts.Rejected):
                    self.state.handoff(receipt, self.origin, 1000)
                return
            context = self.state.handoff(receipt, self.origin, 1000)
        self.assertEqual(context.stat().st_mode & 0o777, 0o440)
        self.assertEqual(context.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(contracts.read(context)["receipt"]["phase"], "pending")
        chown.assert_called_once_with(context, 0, 1000)

    def test_actual_pending_receipt_fsync_failure_prevents_mutators(self):
        runtime = FakeRuntime(self.root)
        original = os.fsync
        def fail_pending(descriptor):
            link = Path(f"/proc/self/fd/{descriptor}")
            if link.is_file() and b'"phase":"pending"' in link.read_bytes():
                raise OSError("synthetic pending file fsync failure")
            original(descriptor)
        with patch("authority.authorize", return_value=auth()), patch("authority.backup", return_value={"path": "/external/backup", "sha256": "f" * 64}), patch("os.fsync", fail_pending):
            with self.assertRaises(OSError):
                lifecycle.deploy(self.state, runtime, self.directory, "deploy")
        self.assertFalse(any(command.startswith("up ") or "run --rm" in command for command in runtime.commands))

    def test_intact_origin_continuation_mints_a_new_context_without_overwriting_old_handoff(self):
        receipt = self.state.reserve(self.binding, self.origin, auth())
        lifecycle.install(self.state, self.directory, self.binding)
        receipt = self.state.advance(receipt, "pending")
        context = self.state.handoff(receipt, self.origin, 1000)
        before = context.read_bytes()
        runtime = FakeRuntime(self.root, self.origin)
        with patch("authority.authorize", return_value=auth("reconcile")):
            recovery.reconcile(self.state, runtime)
        with patch("authority.authorize", return_value=auth("continue")), patch("authority.backup", return_value={"path": "/external/fresh-backup", "sha256": "f" * 64}):
            lifecycle.continue_operation(self.state, runtime, "continue")
        self.assertEqual(context.read_bytes(), before)
        self.assertEqual(len(list((self.root / "runtime").glob("*/*/context.json"))), 2)
        self.assertEqual(self.state.load()[1]["phase"], "completed")

    def test_completed_release_becomes_unknown_when_actual_database_reverts_to_another_known_bundle(self):
        receipt = self.state.reserve(self.binding, self.origin, auth())
        lifecycle.install(self.state, self.directory, self.binding)
        receipt = self.state.advance(receipt, "pending")
        target = observed(contracts.BUNDLE, contracts.SCHEMA)
        receipt = lifecycle.verified(self.state, receipt, target)
        runtime = FakeRuntime(self.root, target)
        lifecycle.finish(self.state, runtime, receipt)
        runtime.value = observed("legacy300-v1", contracts.SCHEMA)
        with patch("authority.authorize", return_value=auth("reconcile")), self.assertRaises(contracts.Rejected):
            recovery.reconcile(self.state, runtime)
        self.assertEqual(self.state.load()[0]["status"], "unknown")

    def test_every_recorded_publication_prefix_can_only_complete_after_fresh_finalization(self):
        receipt = self.state.reserve(self.binding, self.origin, auth())
        lifecycle.install(self.state, self.directory, self.binding)
        receipt = self.state.advance(receipt, "pending")
        target = observed(contracts.BUNDLE, contracts.SCHEMA)
        receipt = lifecycle.verified(self.state, receipt, target)
        receipt = self.state.advance(receipt, "runtime_verified", "verified")
        receipt = self.state.advance(receipt, "smoke_verified", "verified")
        intent = publication.desired(self.root, self.binding)
        receipt = {**receipt, "phase": "publication_intent", "publication": intent,
            "predecessorEvidence": self.state.load()[0]["evidenceRef"]}
        self.state.save(receipt, "verified")
        for length in range(5):
            with tempfile.TemporaryDirectory() as temporary, self.subTest(length=length):
                root = Path(temporary) / "host"
                shutil.copytree(self.root, root, symlinks=True)
                state = State(root)
                for name in publication.ORDER[:length]:
                    value = intent["desired"][name]
                    if name in ("current", "previous"):
                        durable.link(root, name, value)
                    else:
                        durable.write(root / "state" / name, (value + "\n").encode())
                before = publication.snapshot(root)
                runtime = FakeRuntime(root, target)
                with patch("authority.authorize", return_value=auth("reconcile")):
                    recovery.reconcile(state, runtime)
                self.assertEqual(publication.snapshot(root), before)
                self.assertNotEqual(state.load()[1]["phase"], "completed")
                with patch("authority.authorize", return_value=auth("finalize-publication")):
                    lifecycle.continue_operation(state, runtime, "finalize-publication")
                self.assertEqual(state.load()[1]["phase"], "completed")
                self.assertEqual(publication.snapshot(root), intent["desired"])


if __name__ == "__main__":
    unittest.main()
