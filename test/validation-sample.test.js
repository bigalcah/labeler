import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {promisify} from "node:util";
import {parse} from "csv-parse/sync";
import {REQUIRED_AGENTS, ValidationSampleError, createValidationSample, stageFile, writeOutputPair} from "../scripts/select-validation-sample.js";
import {readPullRequestCards} from "../util/csv-pr-provider.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const canonicalSource = new URL("../plans/merged_after_rework_cards_seed_20260510.csv", import.meta.url);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const runSelector = (sourcePath, fixturePath, manifestPath) => execFileAsync("npm", [
    "run", "sample:validation:30", "--", sourcePath, fixturePath, manifestPath,
], {cwd: root});

const syntheticSource = transform => {
    const rows = Array.from({length: 300}, (_, index) => {
        const agent = REQUIRED_AGENTS[index % REQUIRED_AGENTS.length];
        return [ `card-${index}`, agent ];
    });
    transform(rows);
    return Buffer.from(`card_id,agent\n${rows.map(row => row.join(",")).join("\n")}\n`);
};

test("canonical CSV importer preserves the existing 300-card parsing contract", async () => {
    const result = await readPullRequestCards(canonicalSource, {expectedCardCount: 300});
    const agentCounts = {};
    for (const card of result.cards) {
        const agent = card.raw_payload.agent;
        agentCounts[agent] = (agentCounts[agent] || 0) + 1;
    }

    assert.equal(result.sourceChecksum, "4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef");
    assert.equal(result.cards.length, 300);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(agentCounts, {Claude_Code: 7, Copilot: 145, Cursor: 17, Devin: 86, OpenAI_Codex: 45});
    assert.equal(result.cards[0].source_card_id, "3078006902-A");
    assert.equal(result.cards[0].raw_payload.evidence_raw_text.split("\n").length, 19);
    assert.equal(result.cards[0].evidence.all.length, 53);
});

test("validation sample command emits the deterministic fixture contract", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-validation-sample-"));
    const fixturePath = path.join(directory, "validation.csv");
    const manifestPath = path.join(directory, "validation.manifest.json");

    try {
        const {stdout} = await runSelector(canonicalSource.pathname, fixturePath, manifestPath);
        const fixture = await readFile(fixturePath, "utf8");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        const sourceRecords = parse(await readFile(canonicalSource), {bom: true, skip_empty_lines: true});
        const fixtureRecords = parse(fixture, {columns: true, skip_empty_lines: true});
        const sourceRows = parse(await readFile(canonicalSource), {columns: true, bom: true, skip_empty_lines: true});
        const sourceById = new Map(sourceRows.map(row => [ row.card_id, row ]));
        const expectedIds = REQUIRED_AGENTS.flatMap(agent => sourceRows
            .filter(row => row.agent === agent)
            .map(row => ({id: row.card_id, hash: sha256(`${agent}\0${row.card_id}`)}))
            .sort((left, right) => compareText(left.hash, right.hash) || compareText(left.id, right.id))
            .slice(0, 6)
            .map(entry => entry.id));

        assert.match(stdout, /Validation sample created: 30 cards/);
        assert.equal(fixtureRecords.length, 30);
        assert.deepEqual(Object.keys(fixtureRecords[0]), sourceRecords[0]);
        assert.deepEqual(fixtureRecords.map(row => row.card_id), expectedIds);
        assert.deepEqual(fixtureRecords.map(row => row), expectedIds.map(id => sourceById.get(id)));
        assert.equal(manifest.manifestVersion, 1);
        assert.equal(manifest.source.sha256, "4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef");
        assert.equal(manifest.source.rowCount, 300);
        assert.equal(manifest.source.columnCount, 69);
        assert.equal(manifest.subset.sha256, sha256(fixture));
        assert.equal(manifest.subset.rowCount, 30);
        assert.deepEqual(manifest.orderedCardIds, expectedIds);
        assert.deepEqual(manifest.distribution, Object.fromEntries(REQUIRED_AGENTS.map(agent => [ agent, 6 ])));

        const imported = await readPullRequestCards(fixturePath, {expectedCardCount: 30});
        assert.deepEqual(imported.errors, []);
        assert.equal(new Set(imported.cards.map(card => card.source_card_id)).size, 30);
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("validation sample rerun is byte-identical", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-validation-rerun-"));
    const fixturePath = path.join(directory, "validation.csv");
    const manifestPath = path.join(directory, "validation.manifest.json");

    try {
        await runSelector(canonicalSource.pathname, fixturePath, manifestPath);
        const first = await Promise.all([ readFile(fixturePath), readFile(manifestPath) ]);
        await runSelector(canonicalSource.pathname, fixturePath, manifestPath);
        const second = await Promise.all([ readFile(fixturePath), readFile(manifestPath) ]);

        assert.deepEqual(second, first);
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("sample validation rejects duplicate IDs before selection", () => {
    const source = syntheticSource(rows => {
        rows[299][0] = rows[0][0];
    });

    assert.throws(
        () => createValidationSample(source, sha256(source)),
        error => error instanceof ValidationSampleError && error.code === "DUPLICATE_CARD_ID",
    );
});

test("sample validation rejects a missing required agent before selection", () => {
    const source = syntheticSource(rows => {
        for (const row of rows) if (row[1] === "Claude_Code") row[1] = "Copilot";
    });

    assert.throws(
        () => createValidationSample(source, sha256(source)),
        error => error instanceof ValidationSampleError && error.code === "MISSING_REQUIRED_AGENT",
    );
});

test("sample validation rejects malformed CSV before selection", () => {
    const source = Buffer.from("card_id,agent\n\"unterminated,Copilot\n");

    assert.throws(
        () => createValidationSample(source, sha256(source)),
        error => error instanceof ValidationSampleError && error.code === "MALFORMED_CSV",
    );
});

test("changed source checksum fails closed without replacing outputs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-validation-checksum-"));
    const sourcePath = path.join(directory, "changed.csv");
    const fixturePath = path.join(directory, "validation.csv");
    const manifestPath = path.join(directory, "validation.manifest.json");
    const changedSource = Buffer.concat([ await readFile(canonicalSource), Buffer.from(" ") ]);
    await Promise.all([
        writeFile(sourcePath, changedSource),
        writeFile(fixturePath, "existing fixture\n"),
        writeFile(manifestPath, "existing manifest\n"),
    ]);

    try {
        await assert.rejects(
            () => runSelector(sourcePath, fixturePath, manifestPath),
            error => error.code === 1
                && !error.stdout.includes("Validation sample created")
                && error.stderr.includes("SOURCE_CHECKSUM_MISMATCH"),
        );
        assert.equal(await readFile(fixturePath, "utf8"), "existing fixture\n");
        assert.equal(await readFile(manifestPath, "utf8"), "existing manifest\n");
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("output write failure leaves both existing outputs unchanged", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-validation-write-"));
    const lockedDirectory = path.join(directory, "locked");
    const fixturePath = path.join(directory, "validation.csv");
    const manifestPath = path.join(lockedDirectory, "validation.manifest.json");
    await mkdir(lockedDirectory);
    await Promise.all([
        writeFile(fixturePath, "existing fixture\n"),
        writeFile(manifestPath, "existing manifest\n"),
    ]);
    await chmod(lockedDirectory, 0o500);

    try {
        await assert.rejects(() => runSelector(canonicalSource.pathname, fixturePath, manifestPath));
        assert.equal(await readFile(fixturePath, "utf8"), "existing fixture\n");
        assert.equal(await readFile(manifestPath, "utf8"), "existing manifest\n");
    } finally {
        await chmod(lockedDirectory, 0o700);
        await rm(directory, {recursive: true});
    }
});

test("post-open write failure removes the partial temporary file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-validation-limit-"));
    const fixturePath = path.join(directory, "validation.csv");
    const manifestPath = path.join(directory, "validation.manifest.json");
    await Promise.all([ writeFile(fixturePath, "existing fixture\n"), writeFile(manifestPath, "existing manifest\n") ]);

    try {
        await assert.rejects(() => execFileAsync("bash", [
            "-c", "ulimit -f 1; exec \"$@\"", "validation-limit", process.execPath,
            path.join(root, "scripts/select-validation-sample.js"), canonicalSource.pathname, fixturePath, manifestPath,
        ], {cwd: root}));
        assert.equal(await readFile(fixturePath, "utf8"), "existing fixture\n");
        assert.equal(await readFile(manifestPath, "utf8"), "existing manifest\n");
        assert.deepEqual((await readdir(directory)).sort(), [ "validation.csv", "validation.manifest.json" ]);
    } finally {
        await rm(directory, {recursive: true});
    }
});

test("staging preserves the write error when close also fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-validation-errors-"));
    const writeError = new Error("write failed");
    const closeError = new Error("close failed");
    const cleanupError = new Error("cleanup failed");
    const removed = [];
    const operations = {
        open: async () => ({writeFile: async () => { throw writeError; }, sync: async () => {}, close: async () => { throw closeError; }}),
        rm: async temporaryPath => { removed.push(temporaryPath); throw cleanupError; },
    };

    try {
        await assert.rejects(() => stageFile(path.join(directory, "validation.csv"), "content", operations), error => error === writeError);
        assert.equal(removed.length, 1);
        assert.deepEqual(writeError.suppressedErrors, [ closeError, cleanupError ]);
    } finally {
        await rm(directory, {recursive: true});
    }
});

const assertInterruptionRollback = async checkpointToInterrupt => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "labeler-validation-interrupt-"));
    const paths = [ path.join(directory, "validation.csv"), path.join(directory, "validation.manifest.json") ];
    await Promise.all(paths.map((filePath, index) => writeFile(filePath, `existing ${index}\n`)));
    let checkpoint = 0;
    try {
        await assert.rejects(
            () => writeOutputPair([
                {filePath: paths[0], content: "new fixture\n"},
                {filePath: paths[1], content: "new manifest\n"},
            ], () => ++checkpoint === checkpointToInterrupt),
            error => error instanceof ValidationSampleError && error.code === "INTERRUPTED",
        );
        assert.deepEqual(await Promise.all(paths.map(filePath => readFile(filePath, "utf8"))), [ "existing 0\n", "existing 1\n" ]);
    } finally {
        await rm(directory, {recursive: true});
    }
};

test("interruption after first publication rolls back the output pair", () => assertInterruptionRollback(4));
test("interruption after final publication rolls back the output pair", () => assertInterruptionRollback(6));

test("rollback failures do not replace the publication error", async () => {
    const publicationError = new Error("publication failed");
    const cleanupError = new Error("cleanup failed");
    const rollbackError = new Error("rollback failed");
    let renames = 0;
    const operations = {
        readExisting: async () => Buffer.from("existing"),
        stageFile: async filePath => `${filePath}.tmp`,
        rename: async () => { if (++renames === 2) throw publicationError; if (renames === 3) throw rollbackError; },
        rm: async () => { throw cleanupError; },
    };
    await assert.rejects(() => writeOutputPair([
        {filePath: "/fixture", content: "fixture"}, {filePath: "/manifest", content: "manifest"},
    ], () => false, operations), error => error === publicationError);
    assert.deepEqual(publicationError.suppressedErrors, [ cleanupError, rollbackError ]);
});
