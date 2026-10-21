"""Closed JSON boundaries shared by the host-only release controller."""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path
from typing import Final, Literal, NoReturn, TypeAlias

Json: TypeAlias = None | bool | int | float | str | list["Json"] | dict[str, "Json"]
Document: TypeAlias = dict[str, Json]
Action: TypeAlias = Literal["adopt", "deploy", "rollback", "maintenance", "maintenance-normalize",
                            "maintenance-history", "continue", "finalize-publication", "reconcile"]
LIMIT: Final = 65536
SCHEMA: Final = "study-schema-4"
BUNDLE: Final = "copilot369-v1"
TARGET: Final = {"schema": SCHEMA, "dataBundle": BUNDLE}
RETIRED: Final = "014_copilot_369_cardinality"
RETIRED_FINGERPRINT: Final = "6d2ac8e6283a6ef3e9b79f70c2a3844f0c2e03f6a5a3ad5578bc10415c930858"
FILES: Final = ("Caddyfile", "docker-compose.yml", "release-manifest.json")
RELEASE: Final = r"(0|[1-9][0-9]{0,9})-([1-9][0-9]{0,9})-([a-f0-9]{40})"
HASH: Final = r"[a-f0-9]{64}"
IMAGE: Final = r"ghcr\.io/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+:sha-([a-f0-9]{40})@sha256:([a-f0-9]{64})"


class Rejected(Exception):
    """A sanitized boundary contract failure."""


def require(condition: bool, contract: str) -> None:
    if not condition:
        raise Rejected(contract)


def assert_never(_value: NoReturn) -> NoReturn:
    raise Rejected("unreachable operation")


def shape(value: Json, keys: str) -> Document:
    require(type(value) is dict and set(value) == set(keys.split()), "invalid object keys")
    return value


def text(value: Json, pattern: str = r"[^\x00-\x1f]{1,1024}") -> str:
    require(type(value) is str and re.fullmatch(pattern, value) is not None, "invalid string")
    return value


def number(value: Json, minimum: int = 0) -> int:
    require(type(value) is int and minimum <= value <= 2147483647, "invalid integer")
    return value


def timestamp(value: Json) -> str:
    stamp = text(value, r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
    try:
        dt.datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as error:
        raise Rejected("invalid UTC timestamp") from error
    return stamp


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def pairs(entries: list[tuple[str, Json]]) -> Document:
    result: Document = {}
    for key, value in entries:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result


def decode(raw: bytes) -> Json:
    require(len(raw) <= LIMIT, "document exceeds 64 KiB")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=lambda _value: require(False, "invalid JSON number"))
    except (ValueError, UnicodeError, RecursionError) as error:
        raise Rejected("invalid UTF-8 JSON") from error


def read(path: Path) -> Json:
    require(path.is_file() and not path.is_symlink(), "unsafe document path")
    with path.open("rb") as stream:
        return decode(stream.read(LIMIT + 1))


def encoded(value: Json) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def identity(value: Json) -> Document:
    result = shape(value, "systemIdentifier databaseOid databaseName serverVersion endpoint volume")
    text(result["systemIdentifier"], r"[0-9]+")
    text(result["databaseOid"], r"[0-9]+")
    text(result["databaseName"])
    text(result["serverVersion"], r"[0-9]+")
    text(result["endpoint"])
    text(result["volume"])
    return result


def observation(value: Json) -> Document:
    result = shape(value, "schema dataBundle fingerprint schemaFingerprint observedAt databaseIdentity readOnly")
    require(result["schema"] in ("empty", "study-schema-3", SCHEMA, "001_study_foundation", "003_private_pr_discard",
        "004_github_pr_api_enrichment", "005_github_enrichment_checkpoints", "006_github_api_telemetry",
        "007_local_accounts_sessions", "008_login_rate_limits", "009_csrf_contexts", "010_study_scoped_participant_categories",
        "011_multi_study_cardinality", "012_global_normalized_username", "013_category_definition_color", RETIRED), "unknown observed physical schema")
    text(result["dataBundle"], r"empty|legacy300-v1|copilot369-v1")
    text(result["fingerprint"], HASH)
    text(result["schemaFingerprint"], HASH)
    require(result["schema"] != RETIRED or result["schemaFingerprint"] == RETIRED_FINGERPRINT,
            "retired source fingerprint mismatch")
    timestamp(result["observedAt"])
    identity(result["databaseIdentity"])
    access = shape(result["readOnly"], "role transaction grantsVerified writersStopped")
    text(access["role"])
    require(access["transaction"] == "read-only" and access["grantsVerified"] is True,
            "inspection grants or READ ONLY not proved")
    require(type(access["writersStopped"]) is bool, "invalid writer observation")
    return result


def same_state(left: Document, right: Document) -> bool:
    return all(left[key] == right[key] for key in
               ("schema", "dataBundle", "fingerprint", "schemaFingerprint", "databaseIdentity"))
