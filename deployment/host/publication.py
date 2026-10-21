from __future__ import annotations

import os
from pathlib import Path

import durable
import records
from contracts import Document, RELEASE, SCHEMA, require, text

ORDER = ("previous", "current", "active-schema-version", "deployment")


def snapshot(root: Path) -> Document:
    values = {}
    for name in ORDER:
        path = root / name if name in ("previous", "current") else root / "state" / name
        if name in ("previous", "current"):
            require(not path.exists() or path.is_symlink(), "invalid publication pointer")
            require(not path.is_symlink() or path.lstat().st_uid == 0, "untrusted publication pointer")
            values[name] = text(os.readlink(path), "releases/" + RELEASE) if path.is_symlink() else None
        else:
            require(not path.is_symlink(), "unsafe publication metadata")
            require(not path.exists() or (path.stat().st_uid == 0 and path.stat().st_mode & 0o022 == 0), "untrusted publication metadata ownership")
            values[name] = path.read_text().removesuffix("\n") if path.exists() else None
    return records.metadata(values)


def desired(root: Path, binding: Document, floor: int | None = None) -> Document:
    before = snapshot(root)
    release = binding["releaseId"]
    return {"before": before, "desired": {"previous": before["current"], "current": "releases/" + release,
        "active-schema-version": SCHEMA,
        "deployment": f"current={release} previous={(before['current'] or '').removeprefix('releases/')} generation={binding['generation'] if floor is None else floor} schema={SCHEMA}"}}


def prefix(root: Path, intent: Document) -> int:
    actual = snapshot(root)
    for count in reversed(range(5)):
        expected = {name: intent["desired"][name] if index < count else intent["before"][name]
                    for index, name in enumerate(ORDER)}
        if actual == expected:
            return count
    require(False, "publication is not a recorded ordered prefix")
    return 0


def publish(state, receipt: Document) -> Document:
    intent = receipt["publication"]
    start = prefix(state.root, intent)
    for name in ORDER[start:]:
        value = intent["desired"][name]
        if name in ("previous", "current"):
            durable.link(state.root, name, value)
        else:
            require(value is not None, "desired publication metadata missing")
            durable.write(state.root / "state" / name, (value + "\n").encode())
    receipt = state.advance(receipt, "publication_metadata", "verified")
    return state.advance(receipt, "completed", "verified")
