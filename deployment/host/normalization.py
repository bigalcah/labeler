from __future__ import annotations

import authority
import package
import publication
from contracts import Document, require, same_state
from typing import Final

NORMALIZATION_SCHEMA: Final = "study-schema-3"


def checkpoint(state, receipt: Document, probe: Document) -> Document:
    observed = probe["observation"]
    require(probe["applied015"] is True and probe["eligibility"] == "already-applied"
            and observed["schema"] == NORMALIZATION_SCHEMA and observed["dataBundle"] == receipt["origin"]["dataBundle"]
            and observed["databaseIdentity"] == receipt["databaseIdentity"], "canonical schema and actual 015 commit required")
    require(receipt["phase"] in ("pending", "abandoned", "normalization_verified"), "normalization checkpoint requires pending intent")
    if receipt["phase"] == "normalization_verified":
        require(same_state(receipt["target"]["observation"], observed), "normalized checkpoint drift")
        receipt = state.advance(receipt, "abandoned", "verified")
    successor = {**receipt, "phase": "normalization_verified", "predecessorEvidence": state.load()[0]["evidenceRef"],
                 "target": {"schema": NORMALIZATION_SCHEMA, "dataBundle": observed["dataBundle"], "observation": observed}}
    state.save(successor, "verified")
    return successor


def start(state, runtime, source) -> None:
    from lifecycle import install, pending
    release, binding = package.inspect(source)
    journal, previous = state.load() or (None, None)
    require(previous is not None, "host adoption required")
    retry = previous["phase"] == "abandoned" and previous["authorization"]["action"] == "reconcile" and state.normalization_intent(previous)
    require(retry or (journal["status"] == "verified" and previous["phase"] in ("adoption", "completed")),
            "normalization requires adoption or reauthorized intact origin")
    require((retry and previous["candidate"] == binding and state.floor() == binding["generation"])
            or (not retry and binding["generation"] > state.floor()), "normalization candidate or reservation mismatch")
    authorization = authority.authorize(runtime, "maintenance-normalize", binding, previous["origin"])
    require(authorization["writersStopped"] is True, "normalization requires stopped writers authorization")
    runtime.configure(source, release)
    runtime.verify_images(release)
    runtime.verify_normalization_source()
    probe = runtime.normalization_probe()
    origin = probe["observation"]
    require(origin["schema"] in ("014_copilot_369_cardinality", NORMALIZATION_SCHEMA),
            "normalization only accepts its exact schema-3 source")
    require(origin["databaseIdentity"] == journal["databaseIdentity"] and probe["eligibility"] in ("eligible", "already-applied"),
            "normalization requires complete known source")
    require(not retry or same_state(origin, previous["origin"]), "normalization retry origin changed")
    runtime.writers_stopped()
    backup_ref = authority.backup(runtime, origin)
    require(same_state(runtime.observe(), origin), "origin drift before normalization reservation")
    runtime.unchanged_mounts()
    before = publication.snapshot(state.root)
    destination = install(state, source, binding)
    runtime.configure(destination, release)
    receipt = previous if retry else state.reserve(binding, origin, authorization)
    receipt = {**receipt, "authorization": authorization, "backupRef": backup_ref,
               "publication": {"before": before, "desired": before}}
    receipt = pending(state, receipt)
    fresh = runtime.observe()
    require(same_state(fresh, origin) and fresh["readOnly"]["writersStopped"] is True, "normalization origin changed before handoff")
    runtime.writers_stopped()
    runtime.unchanged_mounts()
    context = state.handoff(receipt, fresh, 1000)
    runtime.environment["LABELER_RELEASE_CONTEXT_HOST_PATH"] = str(context)
    if not probe["applied015"]:
        runtime.normalize()
    checkpoint(state, receipt, runtime.normalization_probe())
    require(publication.snapshot(state.root) == before, "normalization changed publication")


def continue_checkpoint(state, runtime, receipt: Document) -> None:
    require(False, "normalization is schema-3 only; explicit maintenance history is required before continuation")
