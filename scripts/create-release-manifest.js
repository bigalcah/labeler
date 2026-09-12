import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";

const REQUIRED_OPTIONS = Object.freeze([
    "--generation",
    "--attempt",
    "--commit",
    "--server-image",
    "--database-image",
    "--csv",
    "--schema-produces",
    "--schema-application-supports",
    "--workflow",
    "--created-at",
    "--output",
]);
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const IMAGE_PATTERN = /^([a-z0-9][a-z0-9._/-]*):sha-([a-f0-9]{40})@(sha256:[a-f0-9]{64})$/;
const SCHEMA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WORKFLOW_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const CREATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MAX_RELEASE_NUMBER = 2_147_483_647;
const CSV_CONTAINER_PATH = "/labeling/data/pr-cards.csv";

class ReleaseManifestError extends Error {
    constructor(code) {
        super(code);
        this.name = "ReleaseManifestError";
        this.code = code;
    }
}

const assertReleaseNumber = (value, minimum, code) => {
    if (!Number.isSafeInteger(value) || value < minimum || value > MAX_RELEASE_NUMBER) {
        throw new ReleaseManifestError(code);
    }
};

const assertImageReference = (reference, commit) => {
    const match = typeof reference === "string" ? reference.match(IMAGE_PATTERN) : null;
    if (!match || match[2] !== commit) throw new ReleaseManifestError("INVALID_IMAGE_REFERENCE");
    return reference;
};

const assertSchemaCompatibility = (produces, applicationSupports) => {
    const supportsValid = Array.isArray(applicationSupports)
        && applicationSupports.length > 0
        && applicationSupports.every(schema => typeof schema === "string" && SCHEMA_PATTERN.test(schema))
        && new Set(applicationSupports).size === applicationSupports.length
        && applicationSupports.includes(produces);
    if (typeof produces !== "string" || !SCHEMA_PATTERN.test(produces) || !supportsValid) {
        throw new ReleaseManifestError("INVALID_SCHEMA_COMPATIBILITY");
    }
};

const assertCreatedAt = createdAt => {
    if (typeof createdAt !== "string" || !CREATED_AT_PATTERN.test(createdAt)
        || new Date(createdAt).toISOString() !== createdAt.replace("Z", ".000Z")) {
        throw new ReleaseManifestError("INVALID_CREATED_AT");
    }
};

const createReleaseManifest = input => {
    assertReleaseNumber(input.generation, 0, "INVALID_GENERATION");
    assertReleaseNumber(input.attempt, 1, "INVALID_ATTEMPT");
    if (typeof input.commit !== "string" || !COMMIT_PATTERN.test(input.commit)) {
        throw new ReleaseManifestError("INVALID_COMMIT");
    }
    if (typeof input.workflow !== "string" || !WORKFLOW_PATTERN.test(input.workflow)) {
        throw new ReleaseManifestError("INVALID_WORKFLOW");
    }
    assertCreatedAt(input.createdAt);
    assertSchemaCompatibility(input.schemaProduces, input.applicationSupports);
    if (!Buffer.isBuffer(input.csv)) throw new ReleaseManifestError("INVALID_CSV");

    return Object.freeze({
        schemaVersion: 1,
        releaseId: `${input.generation}-${input.attempt}-${input.commit}`,
        generation: input.generation,
        commit: input.commit,
        images: Object.freeze({
            server: assertImageReference(input.serverImage, input.commit),
            database: assertImageReference(input.databaseImage, input.commit),
        }),
        csv: Object.freeze({
            path: CSV_CONTAINER_PATH,
            sha256: createHash("sha256").update(input.csv).digest("hex"),
            commit: input.commit,
        }),
        schemaCompatibility: Object.freeze({
            produces: input.schemaProduces,
            applicationSupports: Object.freeze([...input.applicationSupports]),
        }),
        workflow: input.workflow,
        createdAt: input.createdAt,
    });
};

const parseArguments = argumentsList => {
    if (argumentsList.length !== REQUIRED_OPTIONS.length * 2) {
        throw new ReleaseManifestError("USAGE");
    }
    const options = new Map();
    for (let index = 0; index < argumentsList.length; index += 2) {
        const option = argumentsList[index];
        const value = argumentsList[index + 1];
        if (!REQUIRED_OPTIONS.includes(option) || !value || options.has(option)) {
            throw new ReleaseManifestError("USAGE");
        }
        options.set(option, value);
    }
    if (REQUIRED_OPTIONS.some(option => !options.has(option))) throw new ReleaseManifestError("USAGE");
    return options;
};

const parseReleaseNumber = (value, minimum, code) => {
    if (!/^(?:0|[1-9][0-9]{0,9})$/.test(value)) throw new ReleaseManifestError(code);
    const number = Number(value);
    assertReleaseNumber(number, minimum, code);
    return number;
};

const run = async argumentsList => {
    const options = parseArguments(argumentsList);
    const applicationSupports = options.get("--schema-application-supports").split(",");
    const csv = await readFile(path.resolve(options.get("--csv")));
    const manifest = createReleaseManifest({
        generation: parseReleaseNumber(options.get("--generation"), 0, "INVALID_GENERATION"),
        attempt: parseReleaseNumber(options.get("--attempt"), 1, "INVALID_ATTEMPT"),
        commit: options.get("--commit"),
        serverImage: options.get("--server-image"),
        databaseImage: options.get("--database-image"),
        csv,
        schemaProduces: options.get("--schema-produces"),
        applicationSupports,
        workflow: options.get("--workflow"),
        createdAt: options.get("--created-at"),
    });
    await writeFile(path.resolve(options.get("--output")), `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o644,
    });
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    try {
        await run(process.argv.slice(2));
        process.stdout.write("RELEASE_MANIFEST_CREATED\n");
    } catch (error) {
        const code = error instanceof ReleaseManifestError ? error.code : "RELEASE_MANIFEST_WRITE_FAILED";
        process.stderr.write(`RELEASE_MANIFEST_FAILED: ${code}\n`);
        process.exitCode = 1;
    }
}

export {createReleaseManifest, ReleaseManifestError, run};
