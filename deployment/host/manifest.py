"""Release-v2 ingress and independent historical-v1 inventory."""
from __future__ import annotations

import re
from typing import Final

from contracts import Document, HASH, IMAGE, Json, RELEASE, TARGET, number, require, shape, text, timestamp

ARTIFACTS: Final = (
    ("/labeling/data/copilot-369-cards.csv", "fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb"),
    ("/labeling/data/copilot-369-cards.manifest.json", "1837bc7a8cbd366349c8bc207cc236a0dec9d0b04f7f63325ee525884faf3f3a"),
    ("/labeling/data/validation-30-cards.csv", "1607cfe84cb687a2cc7b4c56d3e0abf106b1a1044810d7390663ef1d691b63ab"),
    ("/labeling/data/validation-30-cards.manifest.json", "5049b9357468ce98bd4f83057ea3e59178a5d03793f97800252d7e3e87e7dc1a"),
)
ROOT: Final = "schemaVersion releaseId generation commit images dataBundle schemaCompatibility dataCompatibility workflow createdAt"


def release_identity(manifest: Document) -> None:
    commit = text(manifest["commit"], r"[a-f0-9]{40}")
    release_id = text(manifest["releaseId"], RELEASE)
    match = re.fullmatch(RELEASE, release_id)
    require(match is not None, "invalid release ID")
    require(number(manifest["generation"]) == int(match[1]) and int(match[2]) <= 2147483647
            and match[3] == commit, "inconsistent release identity")
    images = shape(manifest["images"], "server database")
    for image in images.values():
        image_match = re.fullmatch(IMAGE, text(image))
        require(image_match is not None and image_match[1] == commit, "image commit mismatch")
    workflow = text(manifest["workflow"], r"[A-Za-z0-9][A-Za-z0-9._/-]{0,255}")
    require(re.search(r"secret|password|token|credential|private[_-]?key", workflow, re.I) is None,
            "forbidden workflow identity")
    timestamp(manifest["createdAt"])


def validate(value: Json) -> Document:
    manifest = shape(value, ROOT)
    require(type(manifest["schemaVersion"]) is int and manifest["schemaVersion"] == 2, "v2 required at ingress")
    release_identity(manifest)
    profiles = shape(manifest["dataBundle"], "profiles")["profiles"]
    require(type(profiles) is list and len(profiles) == 2, "ordered 369+30 profiles required")
    for index, (key, count) in enumerate((("pr-card-sorting-local", 369), ("pr-card-sorting-validation-30", 30))):
        profile = shape(profiles[index], "studyKey expectedCardCount csv manifest")
        require(profile["studyKey"] == key and type(profile["expectedCardCount"]) is int
                and profile["expectedCardCount"] == count, "noncanonical profile")
        for offset, kind in enumerate(("csv", "manifest")):
            artifact = shape(profile[kind], "path sha256")
            require((artifact["path"], artifact["sha256"]) == ARTIFACTS[index * 2 + offset], "noncanonical artifact")
    for field, token in (("schemaCompatibility", TARGET["schema"]), ("dataCompatibility", TARGET["dataBundle"])):
        compatibility = shape(manifest[field], "produces applicationSupports")
        require(compatibility == {"produces": token, "applicationSupports": [token]}, "invalid compatibility axes")
    return manifest


def historical(value: Json) -> Document:
    require(type(value) is dict, "invalid historical manifest")
    if value.get("schemaVersion") == 2:
        return validate(value)
    manifest = shape(value, "schemaVersion releaseId generation commit images csv schemaCompatibility workflow createdAt")
    require(type(manifest["schemaVersion"]) is int and manifest["schemaVersion"] == 1, "unknown historical version")
    release_identity(manifest)
    csv = shape(manifest["csv"], "path sha256 commit")
    require(csv["path"] == "/labeling/data/pr-cards.csv" and csv["commit"] == manifest["commit"], "invalid v1 source")
    text(csv["sha256"], HASH)
    support = shape(manifest["schemaCompatibility"], "produces applicationSupports")
    text(support["produces"], r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
    require(type(support["applicationSupports"]) is list and len(support["applicationSupports"]) > 0,
            "invalid historical support")
    require(support["produces"] in support["applicationSupports"], "invalid historical produced schema")
    for token in support["applicationSupports"]:
        text(token, r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
    require(len(set(support["applicationSupports"])) == len(support["applicationSupports"]), "duplicate historical support")
    return manifest
