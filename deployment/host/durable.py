"""Durable host filesystem operations; all callers hold the common flock."""
from __future__ import annotations

import contextlib
import fcntl
import os
import stat
import tempfile
from pathlib import Path
from typing import Iterator

from contracts import Json, encoded, require


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def directory(path: Path) -> None:
    if not path.exists():
        path.mkdir(mode=0o700)
        sync_directory(path.parent)
    require(path.is_dir() and not path.is_symlink(), "unsafe host state directory")
    require(path.stat().st_uid == 0 and path.stat().st_mode & 0o022 == 0, "host state directories must be root-owned and protected")


def write(path: Path, payload: bytes, immutable: bool = False) -> None:
    require(not path.is_symlink(), "unsafe durable file")
    descriptor, temporary = tempfile.mkstemp(prefix=".durable-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fchmod(stream.fileno(), 0o440 if immutable else 0o600)
            os.fsync(stream.fileno())
        if immutable:
            os.link(temporary, path, follow_symlinks=False)
            os.unlink(temporary)
        else:
            os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def document(path: Path, payload: Json, immutable: bool = False) -> None:
    write(path, encoded(payload), immutable)


def link(root: Path, name: str, target: str | None) -> None:
    path = root / name
    require(not path.exists() or path.is_symlink(), "publication pointer is not a symlink")
    if target is None:
        if path.is_symlink():
            path.unlink()
    else:
        temporary = root / f".{name}-{os.getpid()}"
        os.symlink(target, temporary)
        os.replace(temporary, path)
    sync_directory(root)


@contextlib.contextmanager
def lock(root: Path) -> Iterator[None]:
    directory(root / "locks")
    descriptor = os.open(root / "locks/deploy.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "unsafe lock file")
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield
