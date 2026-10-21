import {writeFile} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {
    createReleaseManifest,
    ReleaseManifestError,
} from "../util/release-manifest.js";

const REQUIRED_OPTIONS = Object.freeze([
    "--generation",
    "--attempt",
    "--commit",
    "--server-image",
    "--database-image",
    "--workflow",
    "--created-at",
    "--output",
]);
const USAGE = "Usage: npm run release:manifest -- --generation <integer> --attempt <integer> --commit <40-lowercase-hex> "
    + "--server-image <ghcr-image-reference> --database-image <ghcr-image-reference> "
    + "--workflow release/<run-id>/<attempt> --created-at <UTC-YYYY-MM-DDTHH:MM:SSZ> --output <path>";

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
    if (!Number.isSafeInteger(number) || number < minimum || number > 2_147_483_647) {
        throw new ReleaseManifestError(code);
    }
    return number;
};

const run = async argumentsList => {
    if (argumentsList.length === 1 && argumentsList[0] === "--help") {
        process.stdout.write(`${USAGE}\n`);
        return false;
    }
    const options = parseArguments(argumentsList);
    const manifest = createReleaseManifest({
        generation: parseReleaseNumber(options.get("--generation"), 0, "INVALID_GENERATION"),
        attempt: parseReleaseNumber(options.get("--attempt"), 1, "INVALID_ATTEMPT"),
        commit: options.get("--commit"),
        serverImage: options.get("--server-image"),
        databaseImage: options.get("--database-image"),
        workflow: options.get("--workflow"),
        createdAt: options.get("--created-at"),
    });
    await writeFile(path.resolve(options.get("--output")), `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o644,
    });
    return true;
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    try {
        const created = await run(process.argv.slice(2));
        if (created) process.stdout.write("RELEASE_MANIFEST_CREATED\n");
    } catch (error) {
        const code = error instanceof ReleaseManifestError ? error.code : "RELEASE_MANIFEST_WRITE_FAILED";
        if (code === "USAGE") process.stderr.write(`${USAGE}\n`);
        process.stderr.write(`RELEASE_MANIFEST_FAILED: ${code}\n`);
        process.exitCode = 1;
    }
}

export {createReleaseManifest, ReleaseManifestError, run};
