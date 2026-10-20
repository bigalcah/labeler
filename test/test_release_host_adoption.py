import json
import tempfile
import unittest
from pathlib import Path

from host_command_fixture import CommandFixture
import contracts


class AdoptionDrain(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.fixture = CommandFixture(Path(self.temporary.name))

    def adopt(self):
        self.fixture.write_authorization("adopt")
        result = self.fixture.run("adopt")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_adoption_drain_is_required_and_inventory_never_restarts_or_prepares(self):
        self.fixture.write_authorization("adopt")
        value = json.loads((self.fixture.root / "authorization.json").read_text())
        value["drain"]["rerunsBlocked"] = False
        (self.fixture.root / "authorization.json").write_text(json.dumps(value))
        result = self.fixture.run("adopt")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.fixture.deploy_root / "state/database-compatibility.json").exists())
        self.adopt()
        self.assertNotIn(" up ", self.fixture.commands())
        self.assertNotIn("labeling-study-prepare", self.fixture.commands())

    def test_adoption_records_container_identity_and_terminal_v1_operations_without_restart(self):
        value = [{"Id": "fixture-running-v1", "Name": "/labeling-server", "Config": {"Image": "historical-image"},
            "State": {"StartedAt": "2026-10-16T12:00:00Z", "Running": True}}]
        (self.fixture.root / "inventory.json").write_text(json.dumps(value))
        self.fixture.write_authorization("adopt")
        path = self.fixture.root / "authorization.json"
        authorization = json.loads(path.read_text())
        for category in ("queued", "running", "awaitingApproval", "retryable", "inFlight"):
            authorization["drain"][category] = [{"id": "synthetic-" + category, "startedAt": "2026-10-16T00:00:00Z",
                "terminalAt": "2026-10-16T01:00:00Z", "status": "cancelled"}]
        path.write_text(json.dumps(authorization))
        before = (self.fixture.root / "observation.json").read_bytes()
        result = self.fixture.run("adopt")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.fixture.root / "observation.json").read_bytes(), before)
        [evidence] = (self.fixture.deploy_root / "evidence/adoption").glob("*-inventory.json")
        inventory = json.loads(evidence.read_text())
        self.assertEqual(inventory["runtime"][0]["id"], "fixture-running-v1")
        self.assertEqual(inventory["runtime"][0]["startedAt"], "2026-10-16T12:00:00Z")
        self.assertTrue(inventory["runtime"][0]["running"])
        journal = contracts.read(self.fixture.deploy_root / "state/database-compatibility.json")
        receipt = contracts.read(self.fixture.deploy_root / journal["evidenceRef"])
        drain = receipt["authorization"]["drain"]
        self.assertEqual((drain["pushesExcluded"], drain["rerunsBlocked"], drain["ciTerminal"]), (True, True, True))
        for category in ("queued", "running", "awaitingApproval", "retryable", "inFlight"):
            self.assertEqual(drain[category], [{"id": "synthetic-" + category, "startedAt": "2026-10-16T00:00:00Z",
                "terminalAt": "2026-10-16T01:00:00Z", "status": "cancelled"}])
        commands = self.fixture.commands()
        self.assertNotIn(" up ", commands)
        self.assertNotIn("labeling-study-prepare", commands)
        self.assertNotIn("psql", commands)
