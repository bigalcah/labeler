import json
import os

from host_command_fixture import CommandFixture
from host_fixture import historical, observed
import contracts


def normalization_fixture(root, bundle="empty", schema=contracts.RETIRED):
    fixture = CommandFixture(root)
    fixture.origin = observed(bundle, schema)
    if schema == contracts.RETIRED:
        fixture.origin["schemaFingerprint"] = contracts.RETIRED_FINGERPRINT
    (root / "observation.json").write_text(json.dumps(fixture.origin))
    fixture.write_backup()
    if bundle == "legacy300-v1":
        baseline = historical()
        directory = fixture.deploy_root / "releases" / baseline["releaseId"]
        directory.mkdir(parents=True)
        (directory / "release-manifest.json").write_text(json.dumps(baseline))
        for name in ("current", "previous"):
            os.symlink("releases/" + directory.name, fixture.deploy_root / name)
    fixture.write_authorization("adopt")
    result = fixture.run("adopt")
    if result.returncode != 0:
        raise AssertionError(result.stderr)
    return fixture


def loaded(fixture):
    journal = contracts.read(fixture.deploy_root / "state/database-compatibility.json")
    return journal, contracts.read(fixture.deploy_root / journal["evidenceRef"])


def normalize(fixture, failure=""):
    from host_fixture import archive
    fixture.write_authorization("maintenance-normalize", fixture.binding)
    return fixture.run("maintenance normalize " + fixture.release["releaseId"], archive(fixture.release).getvalue(), failure)


def preserve_history(fixture, failure=""):
    from host_fixture import archive
    fixture.origin = contracts.read(fixture.root / "observation.json")
    fixture.write_backup()
    fixture.write_authorization("maintenance-history", fixture.binding)
    return fixture.run("maintenance history " + fixture.release["releaseId"], archive(fixture.release).getvalue(), failure)
