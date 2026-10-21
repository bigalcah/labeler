from __future__ import annotations

import hashlib
import io
import tarfile
import zlib
from pathlib import Path
from typing import BinaryIO

import durable
import manifest
import records
from contracts import Document, FILES, read, require


def receive(stream: BinaryIO, destination: Path) -> tuple[Document, Document]:
    archive = stream.read(10485761)
    require(0 < len(archive) <= 10485760, "release archive is empty or exceeds size limit")
    raw = archive
    if archive.startswith(b"\x1f\x8b"):
        decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
        try:
            raw = decompressor.decompress(archive, 3211265)
        except zlib.error as error:
            from contracts import Rejected
            raise Rejected("invalid compressed release archive") from error
        require(decompressor.eof and not decompressor.unused_data, "oversized or concatenated release archive")
    require(len(raw) <= 3211264, "expanded release archive exceeds bounded package size")
    durable.directory(destination)
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as bundle:
        members = bundle.getmembers()
        require(len(members) == 3 and sorted(entry.name for entry in members) == sorted(FILES), "missing duplicate or non-allowlisted archive entry")
        require(not bundle.pax_headers and not any(entry.pax_headers for entry in members), "extended archive metadata is not allowed")
        for entry in members:
            require(entry.isfile() and not entry.issparse() and entry.size <= 1048576, "archive entries must be bounded regular files")
            extracted = bundle.extractfile(entry)
            require(extracted is not None, "unreadable archive entry")
            with extracted:
                durable.write(destination / entry.name, extracted.read(1048577))
        end = max(entry.offset_data + ((entry.size + 511) // 512) * 512 for entry in members)
        require(not raw[end:].strip(b"\x00"), "noncanonical trailing archive payload")
    return inspect(destination)


def inspect(directory: Path) -> tuple[Document, Document]:
    require(directory.is_dir() and not directory.is_symlink() and directory.stat().st_uid == 0
            and directory.stat().st_mode & 0o022 == 0, "unsafe release directory")
    release = manifest.validate(read(directory / "release-manifest.json"))
    hashes = {}
    for name in FILES:
        file = directory / name
        require(file.is_file() and not file.is_symlink() and file.stat().st_size <= 1048576, "unsafe package file")
        hashes[name] = hashlib.sha256(file.read_bytes()).hexdigest()
    binding = records.candidate({"releaseId": release["releaseId"], "generation": release["generation"],
        "commit": release["commit"], "images": release["images"], "packageHashes": hashes})
    return release, binding
