import assert from "node:assert/strict";
import {test} from "node:test";
import {assertSqlReadonly, createRuntimeRehearsal, docker, execute, readSqlWindow} from "./support/real-runtime-rehearsal-fixture.js";
import {runRehearsalController} from "./support/real-runtime-rehearsal-broker.js";

const createRuntimeRehearsalWithRestrictiveUmask = async kind => {
    const originalUmask = process.umask(0o077);
    try {
        return await createRuntimeRehearsal(kind);
    } finally {
        process.umask(originalUmask);
    }
};

test("real backup boundary failure rejects before candidate startup or SQL on a provisioned 001 database", async () => {
    const fixture = await createRuntimeRehearsal("backup");
    try {
        const sqlBefore = await readSqlWindow(fixture);
        const report = await runRehearsalController(fixture, "backup");
        assert.equal(report.result, "FAILED");
        assert.equal(report.failureStage, "backup");
        assert.equal(report.phase, "adoption");
        assert.equal(report.floor, -1);
        assert.equal(report.journal.status, "verified");
        assert.equal(report.origin.schema, "001_study_foundation");
        assert.equal(report.fresh.fingerprint, report.origin.fingerprint);
        assert.deepEqual(report.publicationBefore, report.publicationAfter);
        assert.equal(fixture.commands.some(command => ["up", "prepare"].includes(command.operation)), false);
        const count = assertSqlReadonly((await readSqlWindow(fixture)).slice(sqlBefore.length));
        assert.ok(count > 0, "SQL logging must prove the real observer executed");
        fixture.observations = {report, readonlyStatementCount: count};
    } finally {
        await fixture.close();
    }
});

for (const mode of ["runtime", "smoke", "rollback"]) {
    test(`real ${mode} failure cannot publish success and readonly reconciliation preserves known target rows`, async () => {
        const fixture = await createRuntimeRehearsalWithRestrictiveUmask(mode);
        try {
            const sqlBefore = await readSqlWindow(fixture);
            const report = await runRehearsalController(fixture, mode);
            assert.equal(report.result, "FAILED");
            assert.equal(report.failureStage, mode === "smoke" ? "smoke" : "runtime");
            assert.notEqual(report.failedPhase, "completed");
            assert.equal(report.journal.status, mode === "smoke" ? "pending" : "verified");
            assert.equal(report.journal.effectiveSchema, mode === "smoke" ? null : "study-schema-3");
            assert.equal(report.journal.effectiveDataBundle, mode === "smoke" ? null : "copilot369-v1");
            assert.equal(report.fresh.schema, "study-schema-3");
            assert.equal(report.fresh.dataBundle, "copilot369-v1");
            assert.equal(report.phase, "abandoned");
            assert.equal(report.origin.readOnly.grantsVerified, true);
            assert.equal(report.fresh.fingerprint, report.origin.fingerprint);
            assert.deepEqual(report.publicationBefore, report.publicationAfter);
            assert.ok(fixture.commands.some(command => command.code > 0), "actual runtime/curl failure must reach the controller");
            if (mode === "smoke") {
                assert.equal(report.failedPhase, "runtime_verified");
                assert.ok(fixture.commands.some(command => command.operation === "smoke" && command.code === 28));
            }
            if (mode === "rollback") {
                const faultIndex = fixture.commands.findIndex(command => command.operation === "fault");
                assert.notEqual(faultIndex, -1, "rollback failure must be injected after two successful publications");
                const failedRollback = fixture.commands.slice(faultIndex + 1).find(command =>
                    command.operation === "up" && command.services?.includes("labeling-server") && command.code > 0);
                assert.ok(failedRollback, "the actual rollback runtime command must fail");
                assert.equal(report.floor, 2, "failed rollback must preserve the monotonic generation floor");
            }
            assert.doesNotMatch(fixture.prepareOutput, /> (?:migrate:study|bootstrap:study|prepare:study-profiles)/);
            const states = JSON.parse(await docker(["inspect", `${fixture.project}-app`, `${fixture.project}-edge`]));
            const runtime = states.map(value => ({id: value.Id, name: value.Name, startedAt: value.State.StartedAt,
                imageId: value.Image, running: value.State.Running, paused: value.State.Paused, health: value.State.Health?.Status,
                exitCode: value.State.ExitCode}));
            assert.equal(runtime[0].imageId, fixture.images.server, "the candidate runtime must use the supplied current image");
            if (mode === "smoke") assert.equal(runtime[1].paused, true);
            else assert.equal(runtime[0].running, false);
            const endpoint = states[1].NetworkSettings.Ports["443/tcp"]?.[0]?.HostPort;
            if (endpoint) await assert.rejects(execute("curl", ["--insecure", "--fail", "--silent", "--max-time", "2", `https://localhost:${endpoint}/login`]));
            else assert.equal(runtime[1].running, false, "unpublished edge must not be serving");
            const count = assertSqlReadonly((await readSqlWindow(fixture)).slice(sqlBefore.length));
            assert.ok(count > 0);
            fixture.observations = {report, runtime, readonlyStatementCount: count,
                prepareInvocationCount: fixture.commands.filter(command => command.operation === "prepare").length,
                unavailableAfterFailure: true};
        } finally {
            await fixture.close();
        }
    });
}

for (const mode of ["interrupt-origin", "interrupt-target", "unknown"]) {
    test(`real killed owner ${mode} requires readonly reconcile without preparing, restarting or repairing`, async () => {
        const fixture = await createRuntimeRehearsal(mode === "interrupt-origin" ? "backup" : mode);
        try {
            const interrupted = await runRehearsalController(fixture, mode);
            assert.deepEqual(interrupted, {crashed: true});
            if (mode === "unknown") {
                await docker(["exec", `${fixture.project}-db`, "psql", "-U", "rehearsal", "-d", "rehearsal", "-v", "ON_ERROR_STOP=1",
                    "-c", "CREATE TABLE public.rehearsal_unknown (id integer)"]);
            }
            const commandStart = fixture.commands.length;
            const sqlBefore = await readSqlWindow(fixture);
            const report = await runRehearsalController(fixture, "reconcile");
            assert.equal(report.journal.status, mode === "unknown" ? "unknown" : mode === "interrupt-origin" ? "pending" : "verified");
            assert.equal(report.phase, mode === "unknown" ? "unknown" : mode === "interrupt-origin" ? "abandoned" : "cutover_verified");
            assert.deepEqual(report.publicationBefore, report.publicationAfter);
            assert.equal(fixture.commands.slice(commandStart).some(command => ["up", "prepare", "smoke", "images"].includes(command.operation)), false);
            if (mode !== "unknown") assert.equal(report.fresh.fingerprint, report.origin.fingerprint);
            if (mode === "unknown") {
                assert.equal((await docker(["exec", `${fixture.project}-db`, "psql", "-U", "rehearsal", "-d", "rehearsal", "-Atc",
                    "SELECT to_regclass('public.rehearsal_unknown') IS NOT NULL"])).trim(), "t");
            }
            const count = assertSqlReadonly((await readSqlWindow(fixture)).slice(sqlBefore.length));
            assert.ok(count > 0);
            fixture.observations = {report, killedOwnerExitCode: 137, readonlyStatementCount: count};
        } finally {
            await fixture.close();
        }
    });
}
