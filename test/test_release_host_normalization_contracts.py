import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from host_fixture import FakeRuntime, adopted, auth, candidate, observed
import contracts
import durable
import lifecycle
import normalization
import records
import recovery
from state import State


class NormalizationContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state = State(self.root)
        self.origin = observed("empty", "study-schema-3")
        adopted(self.state, self.origin)
        directory, _, self.binding = candidate(self.root)
        lifecycle.install(self.state, directory, self.binding)

    def pending(self):
        receipt = self.state.reserve(self.binding, self.origin, auth("maintenance-normalize"))
        return self.state.advance(receipt, "pending")

    def test_wrong_action_target_or_observation_is_rejected_by_closed_phase_contract(self):
        receipt = self.pending()
        for mutation in (lambda value: value["authorization"].update(action="maintenance"),
                         lambda value: value["target"].update(dataBundle="copilot369-v1"),
                         lambda value: value.update(phase="runtime_verified")):
            value = copy.deepcopy(receipt)
            mutation(value)
            with self.assertRaises(contracts.Rejected):
                records.receipt(value)

    def test_target_cannot_retarget_before_verified_normalization_boundary(self):
        receipt = self.pending()
        value = {**receipt, "phase": "abandoned", "authorization": auth("reconcile"),
                 "target": {**contracts.TARGET, "observation": None}, "predecessorEvidence": self.state.load()[0]["evidenceRef"]}
        self.state.save(value, "pending")
        with self.assertRaises(contracts.Rejected):
            self.state.load()

    def test_normalization_cannot_be_reclassified_as_final_target_by_changing_authorization(self):
        self.origin = observed(contracts.BUNDLE, contracts.SCHEMA)
        with tempfile.TemporaryDirectory() as temporary:
            state = State(Path(temporary))
            adopted(state, self.origin)
            receipt = state.reserve(self.binding, self.origin, auth("maintenance-normalize"))
            receipt = state.advance(receipt, "pending")
            with self.assertRaises(contracts.Rejected):
                lifecycle.verified(state, {**receipt, "authorization": auth("reconcile")}, self.origin)
                state.load()

    def test_origin_is_immutable_across_checkpoint_even_if_database_identity_stays_equal(self):
        receipt = self.pending()
        altered = {**self.origin, "fingerprint": "f" * 64}
        probe = {"observation": altered, "eligibility": "already-applied", "applied015": True}
        normalization.checkpoint(self.state, receipt, probe)
        journal, checkpoint = self.state.load()
        changed = {**checkpoint, "phase": "pending", "authorization": auth("continue"), "origin": altered,
                   "predecessorEvidence": journal["evidenceRef"], "target": {**contracts.TARGET, "observation": None}}
        self.state.save(changed, "pending")
        with self.assertRaises(contracts.Rejected):
            self.state.load()

    def test_surviving_validated_reservation_repairs_only_floor_and_requires_reauthorization(self):
        original = durable.write
        def interrupted(path, payload, immutable=False):
            if path.name == "highest-generation":
                raise OSError("injected floor failure")
            original(path, payload, immutable)
        with patch("durable.write", interrupted), self.assertRaises(OSError):
            self.state.reserve(self.binding, self.origin, auth("maintenance-normalize"))
        runtime = FakeRuntime(self.root, self.origin)
        with patch("authority.authorize", return_value=auth("reconcile")):
            recovery.reconcile(self.state, runtime)
        self.assertEqual(self.state.floor(), self.binding["generation"])
        self.assertEqual(self.state.load()[1]["phase"], "abandoned")
        self.assertTrue(all(command in ("config", "normalization-probe", "inventory") for command in runtime.commands))

    def test_checkpoint_never_starts_runtime_even_when_copilot_tokens_already_match(self):
        receipt = self.pending()
        runtime = FakeRuntime(self.root, self.origin)
        with self.assertRaises(contracts.Rejected):
            lifecycle.finish(self.state, runtime, {**receipt, "phase": "normalization_verified"})
        self.assertEqual(runtime.commands, [])


if __name__ == "__main__":
    unittest.main()
