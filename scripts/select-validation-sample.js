import {createHash, randomUUID} from "node:crypto";
import {open, readFile, rename, rm, stat} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {parse} from "csv-parse/sync";

const SOURCE_SHA256 = "4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef";
const REQUIRED_AGENTS = Object.freeze([ "Copilot", "Devin", "OpenAI_Codex", "Cursor", "Claude_Code" ]);
const SOURCE_ROW_COUNT = 300;
const CARDS_PER_AGENT = 6;

class ValidationSampleError extends Error {
    constructor(code) {
        super(code);
        this.name = "ValidationSampleError";
        this.code = code;
    }
}

const sha256 = value => createHash("sha256").update(value).digest("hex");
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const addSuppressedError = (error, suppressedError) => {
    if (!error.suppressedErrors) {
        Object.defineProperty(error, "suppressedErrors", {value: [], enumerable: false});
    }
    error.suppressedErrors.push(suppressedError);
};

const parseSource = source => {
    let records;
    try {
        records = parse(source, {bom: true, skip_empty_lines: true});
    } catch (_error) {
        throw new ValidationSampleError("MALFORMED_CSV");
    }
    if (records.length < 2) throw new ValidationSampleError("MALFORMED_CSV");
    const [ headers, ...rows ] = records;
    if (headers.some(header => header === "") || new Set(headers).size !== headers.length) {
        throw new ValidationSampleError("INVALID_HEADER");
    }
    const cardIdIndex = headers.indexOf("card_id");
    const agentIndex = headers.indexOf("agent");
    if (cardIdIndex === -1 || agentIndex === -1) throw new ValidationSampleError("INVALID_HEADER");
    return {headers, rows, cardIdIndex, agentIndex};
};

const csvValue = value => /[",\r\n]/.test(value)
    ? `"${value.replaceAll("\"", "\"\"")}"`
    : value;

const serializeCsv = (headers, rows) => `${[ headers, ...rows ]
    .map(row => row.map(csvValue).join(","))
    .join("\n")}\n`;

const createValidationSample = (source, expectedSourceChecksum = SOURCE_SHA256) => {
    const sourceChecksum = sha256(source);
    if (sourceChecksum !== expectedSourceChecksum) {
        throw new ValidationSampleError("SOURCE_CHECKSUM_MISMATCH");
    }

    const {headers, rows, cardIdIndex, agentIndex} = parseSource(source);
    const rowsByAgent = new Map(REQUIRED_AGENTS.map(agent => [ agent, [] ]));
    const cardIds = new Set();
    for (const row of rows) {
        const cardId = row[cardIdIndex];
        const agent = row[agentIndex];
        if (!cardId) throw new ValidationSampleError("MISSING_CARD_ID");
        if (cardIds.has(cardId)) throw new ValidationSampleError("DUPLICATE_CARD_ID");
        cardIds.add(cardId);
        if (!rowsByAgent.has(agent)) throw new ValidationSampleError("UNEXPECTED_AGENT");
        rowsByAgent.get(agent).push({
            cardId,
            hash: sha256(`${agent}\0${cardId}`),
            row,
        });
    }
    for (const agent of REQUIRED_AGENTS) {
        if (rowsByAgent.get(agent).length < CARDS_PER_AGENT) {
            throw new ValidationSampleError("MISSING_REQUIRED_AGENT");
        }
    }
    if (rows.length !== SOURCE_ROW_COUNT) throw new ValidationSampleError("SOURCE_ROW_COUNT_MISMATCH");

    const selected = REQUIRED_AGENTS.flatMap(agent => rowsByAgent.get(agent)
        .sort((left, right) => compareText(left.hash, right.hash) || compareText(left.cardId, right.cardId))
        .slice(0, CARDS_PER_AGENT));
    const fixture = serializeCsv(headers, selected.map(entry => entry.row));
    const distribution = Object.fromEntries(REQUIRED_AGENTS.map(agent => [ agent, CARDS_PER_AGENT ]));
    const manifest = {
        manifestVersion: 1,
        selectionAlgorithm: {
            name: "sha256-agent-nul-card-id",
            version: 1,
            encoding: "utf8",
            order: "required-agent-order-then-lowercase-hex-digest-then-card-id-code-point",
        },
        requiredAgents: REQUIRED_AGENTS,
        source: {
            sha256: sourceChecksum,
            rowCount: rows.length,
            columnCount: headers.length,
        },
        subset: {
            sha256: sha256(fixture),
            rowCount: selected.length,
            columnCount: headers.length,
        },
        distribution,
        orderedCardIds: selected.map(entry => entry.cardId),
    };
    return {fixture, manifest: `${JSON.stringify(manifest, null, 2)}\n`};
};

const readExisting = async filePath => {
    try {
        const metadata = await stat(filePath);
        if (!metadata.isFile()) throw new ValidationSampleError("OUTPUT_PATH_INVALID");
        return await readFile(filePath);
    } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
    }
};

const stageFile = async (filePath, content, operations = {open, rm}) => {
    const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    const handle = await operations.open(temporaryPath, "wx", 0o600);
    let failure;
    try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
    } catch (error) {
        failure = error;
    }
    try {
        await handle.close();
    } catch (error) {
        if (failure) addSuppressedError(failure, error);
        else failure = error;
    }
    if (!failure) return temporaryPath;
    try {
        await operations.rm(temporaryPath, {force: true});
    } catch (error) {
        addSuppressedError(failure, error);
    }
    throw failure;
};

const writeOutputPair = async (outputs, interrupted = () => false, operations = {readExisting, rename, rm, stageFile}) => {
    const states = await Promise.all(outputs.map(async output => ({
        ...output,
        previous: await operations.readExisting(output.filePath),
        temporaryPath: null,
        published: false,
    })));
    try {
        for (const state of states) {
            if (interrupted()) throw new ValidationSampleError("INTERRUPTED");
            state.temporaryPath = await operations.stageFile(state.filePath, state.content);
        }
        for (const state of states) {
            if (interrupted()) throw new ValidationSampleError("INTERRUPTED");
            await operations.rename(state.temporaryPath, state.filePath);
            state.temporaryPath = null;
            state.published = true;
            if (interrupted()) throw new ValidationSampleError("INTERRUPTED");
        }
    } catch (error) {
        for (const state of states.reverse()) {
            if (state.temporaryPath) {
                try {
                    await operations.rm(state.temporaryPath, {force: true});
                } catch (rollbackError) {
                    addSuppressedError(error, rollbackError);
                }
            }
            if (state.published) {
                try {
                    if (state.previous === null) await operations.rm(state.filePath, {force: true});
                    else {
                        const rollbackPath = await operations.stageFile(state.filePath, state.previous);
                        await operations.rename(rollbackPath, state.filePath);
                    }
                } catch (rollbackError) {
                    addSuppressedError(error, rollbackError);
                }
            }
        }
        throw error;
    }
};

const run = async argumentsList => {
    if (argumentsList.length !== 3 || argumentsList.some(argument => !argument)) {
        throw new ValidationSampleError("USAGE");
    }
    const [ sourcePath, fixturePath, manifestPath ] = argumentsList.map(value => path.resolve(value));
    if (new Set([ sourcePath, fixturePath, manifestPath ]).size !== 3) {
        throw new ValidationSampleError("OUTPUT_PATH_INVALID");
    }

    const source = await readFile(sourcePath);
    const sample = createValidationSample(source);
    let interrupted = false;
    const interrupt = () => {
        interrupted = true;
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    try {
        await writeOutputPair([
            {filePath: fixturePath, content: sample.fixture},
            {filePath: manifestPath, content: sample.manifest},
        ], () => interrupted);
    } finally {
        process.off("SIGINT", interrupt);
        process.off("SIGTERM", interrupt);
    }
    process.stdout.write(`Validation sample created: ${CARDS_PER_AGENT * REQUIRED_AGENTS.length} cards\n`);
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    try {
        await run(process.argv.slice(2));
    } catch (error) {
        const code = error instanceof ValidationSampleError ? error.code : "OUTPUT_WRITE_FAILED";
        process.stderr.write(`VALIDATION_SAMPLE_FAILED: ${code}\n`);
        process.exitCode = 1;
    }
}

export {REQUIRED_AGENTS, SOURCE_SHA256, ValidationSampleError, createValidationSample, run, stageFile, writeOutputPair};
