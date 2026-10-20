import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";

test("isolated 369/30 runtime holds a trusted prepare handoff and confirms all task-scoped cleanup", async () => {
    const configuredEvidenceDirectory = process.env.HARNESS_EVIDENCE_DIR;
    const evidenceDirectory = configuredEvidenceDirectory
        ?? await mkdtemp(path.join(tmpdir(), "labeler-deployment-evidence-"));
    if (configuredEvidenceDirectory) await mkdir(configuredEvidenceDirectory, {recursive: true, mode: 0o700});
    let preserveEvidence = false;
    try {
        const result = spawnSync("sh", ["scripts/test-study-deployment.sh"], {
            encoding: "utf8",
            env: {...process.env, HARNESS_EVIDENCE_DIR: evidenceDirectory},
            maxBuffer: 64 * 1024 * 1024,
            timeout: 30 * 60 * 1000,
        });
        const evidence = `${result.stdout}\n${result.stderr}`;
        const gateReceipts = evidence.split(/\r?\n/).filter(line => line.startsWith("{\"gate\":"));
        await writeFile(path.join(evidenceDirectory, "quality-gate-receipts.jsonl"),
            `${gateReceipts.join("\n")}\n`, {mode: 0o600});
        const receiptPath = path.join(evidenceDirectory, "cleanup-receipt.json");
        const receiptText = existsSync(receiptPath) ? await readFile(receiptPath, "utf8") : "unavailable";

        assert.equal(result.status, 0,
            `${evidence}\ncleanup_receipt=${receiptText}\nSanitized evidence retained at ${evidenceDirectory}`);
        for (const marker of [
            "STAGE_UNTRUSTED_CONTEXT_REJECTIONS_OK", "STAGE_LOCKED_ROOT_HANDOFF_PREPARE_OK",
            "STAGE_ROOT_HANDOFF_CLEANUP_OK", "STAGE_PRIVATE_DISCARD_HTTP_OK",
            "STAGE_CANONICAL_014_NO_015_INITIAL_OK",
            "STAGE_MULTI_STUDY_HOSTILE_E2E_OK", "STAGE_INTEGRATION_SUITE_OK",
            "STAGE_INTERNAL_RUNTIME_HEALTH_OK",
            "STAGE_CANONICAL_014_NO_015_OK",
            "STAGE_SUCCESSIVE_READONLY_PRESERVATION_OK", "STAGE_ORDINARY_EXISTING_REJECTION_OK",
            "STAGE_GUARDED_LEGACY_RETIREMENT_OK", "STAGE_CORRUPT_BACKUP_REJECTION_OK",
            "STAGE_NORMALIZATION_PROBE_OK", "STAGE_NORMALIZATION_PENDING_BEFORE_SQL_OK",
            "STAGE_NORMALIZATION_SQL_VERIFIED_OK", "STAGE_NORMALIZATION_CHECKPOINT_STOP_OK",
            "STAGE_POST_015_PREPARE_OK", "STAGE_FRESH_POST_015_CONTINUATION_OK",
            "STAGE_POST_RETIREMENT_INITIALIZATION_OK", "STAGE_POST_RETIREMENT_PERSISTENCE_OK",
            "STAGE_NORMALIZATION_OWNER_CLEANUP_OK",
            "DEPLOYMENT_HARNESS_OK",
        ]) {
            assert.ok(result.stdout.includes(marker), `missing required runtime stage ${marker}`);
        }
        const stages = [
            "STAGE_UNTRUSTED_CONTEXT_REJECTIONS_OK", "STAGE_LOCKED_ROOT_HANDOFF_PREPARE_OK",
            "STAGE_ROOT_HANDOFF_CLEANUP_OK", "STAGE_CANONICAL_014_NO_015_INITIAL_OK",
            "STAGE_MULTI_STUDY_HOSTILE_E2E_OK",
            "STAGE_INTEGRATION_SUITE_OK", "STAGE_INTERNAL_RUNTIME_HEALTH_OK",
            "STAGE_CANONICAL_014_NO_015_OK",
            "STAGE_SUCCESSIVE_READONLY_PRESERVATION_OK", "STAGE_ORDINARY_EXISTING_REJECTION_OK",
            "STAGE_GUARDED_LEGACY_RETIREMENT_OK", "STAGE_CORRUPT_BACKUP_REJECTION_OK",
            "STAGE_NORMALIZATION_PROBE_OK", "STAGE_NORMALIZATION_PENDING_BEFORE_SQL_OK",
            "STAGE_NORMALIZATION_SQL_VERIFIED_OK", "STAGE_NORMALIZATION_CHECKPOINT_STOP_OK",
            "STAGE_POST_015_PREPARE_OK", "STAGE_FRESH_POST_015_CONTINUATION_OK",
            "STAGE_POST_RETIREMENT_INITIALIZATION_OK", "STAGE_POST_RETIREMENT_PERSISTENCE_OK",
            "STAGE_NORMALIZATION_OWNER_CLEANUP_OK",
        ].map(marker => result.stdout.indexOf(marker));
        assert.deepEqual(stages, [...stages].sort((left, right) => left - right));
        const receipt = JSON.parse(receiptText);
        assert.equal(receipt.workloadExitCode, 0);
        assert.equal(receipt.cleanupVerified, true);
        assert.equal(receipt.temporaryDirectoryRemoved, true);
        assert.equal(receipt.projects.length, 2);
        assert.equal(new Set(receipt.projects.map(project => project.name)).size, 2);
        const cleanProject = receipt.projects.find(project => project.name.endsWith("-clean"));
        const existingProject = receipt.projects.find(project => project.name.endsWith("-existing"));
        assert.deepEqual(cleanProject.images, [`${cleanProject.name}-database-fixture:latest`]);
        assert.deepEqual(existingProject.images, []);
        for (const project of receipt.projects) {
            assert.equal(project.absenceVerified, true, `${project.name} Docker resources must be absent`);
            assert.ok(project.containers.length > 0, `${project.name} must list allocated containers`);
            assert.ok(project.networks.length > 0, `${project.name} must list its allocated network`);
            assert.ok(project.volumes.length > 0, `${project.name} must list its allocated volumes`);
        }
        for (const project of receipt.projects) {
            const handoffOwner = project.handoffOwner;
            assert.equal(handoffOwner.started, true);
            assert.equal(handoffOwner.lockHeldThroughPrepare, true);
            assert.equal(handoffOwner.contextBound, true);
            assert.equal(handoffOwner.ownerCleaned, true);
            assert.equal(handoffOwner.containerRemoved, true);
            assert.equal(handoffOwner.stateRemoved, true);
        }
        assert.doesNotMatch(JSON.stringify(receipt), /password|secret|token|cookie|csrf|credential|hash/i);
        process.stdout.write(`CI_HARNESS_CLEANUP_RECEIPT=${JSON.stringify(receipt)}\n`);
        const protectedBefore = await readFile(path.join(evidenceDirectory, "protected-30-before.sha256"), "utf8");
        const protectedAfter = await readFile(path.join(evidenceDirectory, "protected-30-after.sha256"), "utf8");
        assert.match(protectedBefore, /^[a-f0-9]{64}\n$/);
        assert.equal(protectedAfter, protectedBefore);
        const primaryBefore = await readFile(path.join(evidenceDirectory, "primary-369-before.sha256"), "utf8");
        const primaryAfter = await readFile(path.join(evidenceDirectory, "primary-369-after.sha256"), "utf8");
        assert.match(primaryBefore, /^[a-f0-9]{64}\n$/);
        assert.equal(primaryAfter, primaryBefore);
        const handoff = JSON.parse(await readFile(path.join(evidenceDirectory, "prepare-handoff-binding.json"), "utf8"));
        assert.equal(handoff.lockHeld, true);
        assert.equal(handoff.candidate.releaseId, handoff.receiptCandidate.releaseId);
        assert.deepEqual(handoff.databaseIdentity, handoff.receiptDatabaseIdentity);
        assert.equal(handoff.observation.schema, "001_study_foundation");
        assert.equal(handoff.observation.dataBundle, "empty");
        assert.equal(handoff.observation.readOnly.transaction, "read-only");
        assert.equal(handoff.observation.readOnly.grantsVerified, true);
        assert.equal(handoff.observation.readOnly.writersStopped, true);
        assert.equal(handoff.fileUid, 0);
        assert.equal(handoff.fileGid, 1000);
        assert.equal(handoff.fileMode, 0o440);
        assert.equal(handoff.directoryUid, 0);
        assert.equal(handoff.directoryMode, 0o700);
        assert.equal(handoff.mountDirectoryUid, 0);
        assert.equal(handoff.mountDirectoryMode, 0o700);
        assert.equal(handoff.sameHandoffFile, true);
        assert.doesNotMatch(JSON.stringify(handoff), /password|secret|token|cookie|csrf|credential/i);
        const postRetirementHandoff = JSON.parse(await readFile(
            path.join(evidenceDirectory, "post-retirement-handoff-binding.json"), "utf8"));
        assert.equal(postRetirementHandoff.lockHeld, true);
        assert.equal(postRetirementHandoff.observation.schema, "study-schema-3");
        assert.equal(postRetirementHandoff.observation.dataBundle, "empty");
        assert.equal(postRetirementHandoff.observation.readOnly.transaction, "read-only");
        assert.equal(postRetirementHandoff.observation.readOnly.grantsVerified, true);
        assert.equal(postRetirementHandoff.observation.readOnly.writersStopped, true);
        assert.deepEqual(postRetirementHandoff.databaseIdentity, postRetirementHandoff.receiptDatabaseIdentity);
        assert.doesNotMatch(JSON.stringify(postRetirementHandoff), /password|secret|token|cookie|csrf|credential/i);
        const normalizationPreProbe = JSON.parse(await readFile(
            path.join(evidenceDirectory, "normalization-pre-probe.json"), "utf8"));
        assert.equal(normalizationPreProbe.applied015, false);
        assert.equal(normalizationPreProbe.eligibility, "eligible");
        assert.equal(normalizationPreProbe.observation.schema, "014_copilot_369_cardinality");
        assert.equal(normalizationPreProbe.observation.dataBundle, "empty");
        assert.equal(normalizationPreProbe.observation.readOnly.grantsVerified, true);
        assert.equal(normalizationPreProbe.observation.readOnly.writersStopped, true);
        const normalizationProbe = JSON.parse(await readFile(
            path.join(evidenceDirectory, "normalization-post-probe.json"), "utf8"));
        assert.equal(normalizationProbe.probe.applied015, true);
        assert.equal(normalizationProbe.probe.eligibility, "already-applied");
        assert.equal(normalizationProbe.probe.observation.schema, "study-schema-3");
        assert.equal(normalizationProbe.probe.observation.dataBundle, "empty");
        assert.deepEqual(normalizationProbe.physical,
            {ledger015: true, canonicalFk: true, redundantIndexesAbsent: true});
        const normalizationRowsBefore = await readFile(
            path.join(evidenceDirectory, "normalization-application-rows-before.sha256"), "utf8");
        const normalizationRowsAfter = await readFile(
            path.join(evidenceDirectory, "normalization-application-rows-after.sha256"), "utf8");
        assert.match(normalizationRowsBefore, /^[a-f0-9]{64}\n$/);
        assert.equal(normalizationRowsAfter, normalizationRowsBefore);
        const normalizationCheckpoint = JSON.parse(await readFile(
            path.join(evidenceDirectory, "normalization-checkpoint.json"), "utf8"));
        assert.equal(normalizationCheckpoint.reservation.phase, "normalization_verified");
        assert.equal(normalizationCheckpoint.checkpoint.originPreserved, true);
        assert.equal(normalizationCheckpoint.checkpoint.reservationConsumed, false);
        assert.equal(normalizationCheckpoint.checkpoint.publicationUnchanged, true);
        const normalizationReport = JSON.parse(await readFile(
            path.join(evidenceDirectory, "normalization-report.json"), "utf8"));
        assert.equal(normalizationReport.continuation.phase, "completed");
        assert.equal(normalizationReport.continuation.freshAuthorization, true);
        assert.equal(normalizationReport.continuation.action, "continue");
        assert.equal(normalizationReport.continuation.backupBaselineSchema, "study-schema-3");
        assert.equal(normalizationReport.continuation.backupBaselineDataBundle, "empty");
        assert.ok(normalizationReport.continuation.backupRestoreProofs.every(proof =>
            proof.archiveScope === "full-database" && proof.restoreResult === "verified"
            && proof.restoreIsolated === true && proof.syntheticFixture === true
            && proof.hostBoundaryAccepted === true));
        assert.doesNotMatch(JSON.stringify(normalizationReport), /password|secret|token|cookie|csrf|credential/i);
        const preparedReadiness = JSON.parse(await readFile(
            path.join(evidenceDirectory, "post-retirement-study-readiness.json"), "utf8"));
        assert.equal(preparedReadiness.probe.applied015, true);
        assert.equal(preparedReadiness.probe.observation.dataBundle, "copilot369-v1");
        assert.equal(preparedReadiness.probe.observation.readOnly.writersStopped, true);
        const cleanInitial = JSON.parse(await readFile(path.join(evidenceDirectory, "clean-014-initial.json"), "utf8"));
        const cleanBeforeRerun = JSON.parse(await readFile(path.join(evidenceDirectory, "clean-014-before-rerun.json"), "utf8"));
        const cleanAfterRerun = JSON.parse(await readFile(path.join(evidenceDirectory, "clean-014-after-rerun.json"), "utf8"));
        for (const cleanState of [cleanInitial, cleanBeforeRerun, cleanAfterRerun]) {
            assert.equal(cleanState.probe.applied015, false);
            assert.equal(cleanState.probe.eligibility, "eligible");
            assert.equal(cleanState.probe.observation.schema, "study-schema-3");
            assert.equal(cleanState.probe.observation.dataBundle, "copilot369-v1");
        }
        assert.equal(cleanBeforeRerun.applicationRowsSha256, cleanAfterRerun.applicationRowsSha256);
        const serverImageId = await readFile(path.join(evidenceDirectory, "server-image-id.txt"), "utf8");
        assert.match(serverImageId, /^sha256:[a-f0-9]{64}\n$/);
        assert.deepEqual(JSON.parse(await readFile(
            path.join(evidenceDirectory, "normalization-cli-result.json"), "utf8")),
        {applied015: true, changed: true});
        process.stdout.write(`CI_HARNESS_SERVER_IMAGE_ID=${serverImageId.trim()}\n`);
        process.stdout.write("CI_HARNESS_NORMALIZATION_SQL_VERIFIED=true\n");
        const legacyBefore = await readFile(path.join(evidenceDirectory, "legacy-before-rejection.sha256"), "utf8");
        const legacyAfter = await readFile(path.join(evidenceDirectory, "legacy-after-rejection.sha256"), "utf8");
        assert.match(legacyBefore, /^[a-f0-9]{64}\n$/);
        assert.equal(legacyAfter, legacyBefore);
        const retiredBeforeIdempotent = await readFile(
            path.join(evidenceDirectory, "retired-before-idempotent-apply.sha256"), "utf8");
        const retiredAfterIdempotent = await readFile(
            path.join(evidenceDirectory, "retired-after-idempotent-apply.sha256"), "utf8");
        assert.match(retiredBeforeIdempotent, /^[a-f0-9]{64}\n$/);
        assert.equal(retiredAfterIdempotent, retiredBeforeIdempotent);
        const retiredBeforeCorruptBackup = await readFile(
            path.join(evidenceDirectory, "retired-before-corrupt-backup.sha256"), "utf8");
        const retiredAfterCorruptBackup = await readFile(
            path.join(evidenceDirectory, "retired-after-corrupt-backup.sha256"), "utf8");
        assert.match(retiredBeforeCorruptBackup, /^[a-f0-9]{64}\n$/);
        assert.equal(retiredAfterCorruptBackup, retiredBeforeCorruptBackup);
        const postRetirementBefore = await readFile(
            path.join(evidenceDirectory, "post-retirement-before-restart.sha256"), "utf8");
        const postRetirementAfter = await readFile(
            path.join(evidenceDirectory, "post-retirement-after-restart.sha256"), "utf8");
        assert.match(postRetirementBefore, /^[a-f0-9]{64}\n$/);
        assert.equal(postRetirementAfter, postRetirementBefore);
        process.stdout.write("CI_HARNESS_PROTECTED_30_PRESERVED=true\n");
        process.stdout.write("CI_HARNESS_PRIMARY_369_PRESERVED=true\n");
        process.stdout.write("CI_HARNESS_ROOT_HANDOFF_BOUND=true\n");
    } catch (error) {
        preserveEvidence = true;
        throw error;
    } finally {
        if (!preserveEvidence && !configuredEvidenceDirectory) {
            await rm(evidenceDirectory, {recursive: true, force: true});
        }
    }
});
