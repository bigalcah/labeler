from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from host_fixture import FakeRuntime, adopted, auth, candidate, observed
import contracts
import history
import lifecycle
import publication
import recovery
from state import State


class HistoryCheckpoint(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.state = State(self.root)
        self.origin = observed("empty", "study-schema-3")
        adopted(self.state, self.origin)
        self.source, self.release, self.binding = candidate(self.root, 10)
        self.runtime = FakeRuntime(self.root, self.origin)
        self.backup = {"path": "/external/verified-full-backup", "sha256": "f" * 64}

    def start(self, failure: str | None = None) -> None:
        self.runtime.failure = failure
        with patch("authority.authorize", return_value=auth("maintenance-history")), patch("authority.backup", return_value=self.backup):
            lifecycle.deploy(self.state, self.runtime, self.source, "maintenance-history")

    def test_checkpoint_preserves_origin_publication_and_twelve_root_keys(self) -> None:
        before = publication.snapshot(self.root)
        self.start()
        journal, receipt = self.state.load()
        self.assertEqual((journal["status"], receipt["phase"]), ("verified", "history_schema_verified"))
        self.assertEqual((len(journal), len(receipt)), (12, 12))
        self.assertEqual(receipt["origin"], self.origin)
        self.assertEqual(receipt["target"]["schema"], "study-schema-4")
        self.assertEqual(receipt["target"]["dataBundle"], "empty")
        self.assertEqual(publication.snapshot(self.root), before)
        self.assertNotIn("up labeling-server labeling-caddy", self.runtime.commands)
        self.assertNotIn("cutover", self.runtime.commands)
        self.assertEqual(self.runtime.commands.count("preserve-history"), 1)

    def test_continuation_requires_new_authorization_and_post_history_backup(self) -> None:
        self.start()
        checkpoint = self.state.load()[1]
        with patch("authority.authorize", return_value=auth("continue")), self.assertRaises(contracts.Rejected):
            lifecycle.continue_operation(self.state, self.runtime, "continue")
        self.assertEqual(self.state.load()[1], checkpoint)
        baseline = checkpoint["target"]["observation"]
        fresh = {**auth("continue"), "requestSha256": "e" * 64}
        with patch("authority.authorize", return_value=fresh), patch("authority.backup", return_value=self.backup) as backup:
            lifecycle.continue_operation(self.state, self.runtime, "continue")
        backup.assert_called_once_with(self.runtime, baseline)
        self.assertEqual(self.state.load()[1]["phase"], "completed")
        self.assertEqual(self.state.floor(), 10)
        self.assertEqual(self.runtime.commands.count("preserve-history"), 1)

    def test_crash_after_commit_reconciles_readonly_then_requires_fresh_continuation(self) -> None:
        with self.assertRaises(contracts.Rejected):
            self.start("history-post-commit")
        self.assertEqual(self.state.load()[1]["phase"], "pending")
        self.runtime.failure = None
        count = self.runtime.commands.count("preserve-history")
        with patch("authority.authorize", return_value=auth("reconcile")):
            recovery.reconcile(self.state, self.runtime)
        self.assertEqual(self.state.load()[1]["phase"], "history_schema_verified")
        self.assertEqual(self.runtime.commands.count("preserve-history"), count)
        self.assertNotIn("up labeling-server labeling-caddy", self.runtime.commands)

    def test_crash_before_commit_cannot_continue_or_infer_schema_from_intent(self) -> None:
        with self.assertRaises(contracts.Rejected):
            self.start("history-schema")
        self.runtime.failure = None
        with patch("authority.authorize", return_value=auth("reconcile")):
            recovery.reconcile(self.state, self.runtime)
        self.assertEqual(self.state.load()[1]["phase"], "abandoned")
        with patch("authority.authorize", return_value=auth("continue")), self.assertRaises(contracts.Rejected):
            lifecycle.continue_operation(self.state, self.runtime, "continue")
        self.assertNotIn("up labeling-server labeling-caddy", self.runtime.commands)
        self.start()
        self.assertEqual(self.state.load()[1]["phase"], "history_schema_verified")
        self.assertEqual(self.state.floor(), 10)

    def test_drifted_history_baseline_blocks_continuation_before_backup_or_sql(self) -> None:
        self.start()
        self.runtime.value["fingerprint"] = "0" * 64
        with patch("authority.backup") as backup, self.assertRaises(contracts.Rejected):
            lifecycle.continue_operation(self.state, self.runtime, "continue")
        backup.assert_not_called()
        self.assertEqual(self.runtime.commands.count("preserve-history"), 1)

    def test_retry_preserves_publication_baseline_before_a_new_backup_or_ddl(self) -> None:
        with self.assertRaises(contracts.Rejected):
            self.start("history-schema")
        self.runtime.failure = None
        with patch("authority.authorize", return_value=auth("reconcile")):
            recovery.reconcile(self.state, self.runtime)
        (self.root / "state/active-schema-version").write_text("unexpected")
        with patch("authority.authorize", return_value=auth("maintenance-history")), patch("authority.backup") as backup:
            with self.assertRaises(contracts.Rejected):
                history.start(self.state, self.runtime, self.source)
        backup.assert_not_called()
        self.assertEqual(self.runtime.commands.count("preserve-history"), 1)

    def test_schema3_candidate_is_inventory_only_and_never_accepted_at_ingress(self) -> None:
        import manifest
        legacy = {**self.release, "schemaCompatibility": {"produces": "study-schema-3", "applicationSupports": ["study-schema-3"]}}
        self.assertEqual(manifest.historical(legacy), legacy)
        with self.assertRaises(contracts.Rejected):
            manifest.validate(legacy)

    def test_old_twelve_key_journal_and_receipt_are_read_without_rewriting_evidence(self) -> None:
        legacy_root = self.root / "legacy-inventory"
        legacy_root.mkdir()
        legacy = State(legacy_root)
        origin = observed("legacy300-v1", "013_category_definition_color")
        receipt = adopted(legacy, origin)
        old_receipt = {**receipt, "target": {"schema": "study-schema-3",
            "dataBundle": "copilot369-v1", "observation": None}}
        journal = legacy.save(old_receipt, "verified")
        evidence = legacy_root / journal["evidenceRef"]
        before = (legacy.path.read_bytes(), evidence.read_bytes())
        loaded_journal, loaded_receipt = legacy.load()
        self.assertEqual((len(loaded_journal), len(loaded_receipt)), (12, 12))
        self.assertEqual(loaded_journal["target"]["schema"], "study-schema-3")
        self.assertEqual(loaded_receipt, old_receipt)
        self.assertEqual((legacy.path.read_bytes(), evidence.read_bytes()), before)
