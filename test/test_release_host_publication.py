import shutil
import tempfile
import unittest
from pathlib import Path

from host_fixture import adopted, candidate, observed
import contracts
import durable
import publication
from state import State


class PublicationRecovery(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state = State(self.root)
        self.origin = observed()
        adopted(self.state, self.origin)
        self.directory, self.release, self.binding = candidate(self.root)

    def test_nonprefix_publication_is_blocked_when_metadata_is_out_of_order(self):
        baseline = self.root / "releases" / ("0-1-" + "0" * 40)
        baseline.mkdir()
        durable.link(self.root, "current", "releases/" + baseline.name)
        intent = publication.desired(self.root, self.binding)
        mutations = (
            ("current", lambda root: durable.link(root, "current", intent["desired"]["current"])),
            ("schema", lambda root: durable.write(root / "state/active-schema-version", (intent["desired"]["active-schema-version"] + "\n").encode())),
            ("deployment", lambda root: durable.write(root / "state/deployment", (intent["desired"]["deployment"] + "\n").encode())),
        )
        for name, mutate in mutations:
            with tempfile.TemporaryDirectory() as temporary, self.subTest(name=name):
                root = Path(temporary) / "host"
                shutil.copytree(self.root, root, symlinks=True)
                mutate(root)
                before = publication.snapshot(root)
                with self.assertRaises(contracts.Rejected):
                    publication.prefix(root, intent)
                self.assertEqual(publication.snapshot(root), before)
