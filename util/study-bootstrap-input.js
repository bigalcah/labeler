import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {readPullRequestCards} from "./csv-pr-provider.js";
import {
    COPILOT_369_CANONICAL_FILENAME,
    COPILOT_369_MANIFEST_FILENAME,
    Copilot369SourceError,
    readCopilot369Cards,
} from "./copilot-369-source.js";
import {readCredentialManifest} from "./credential-manifest.js";
import {assertNormalStudyConfig, readStudyConfig} from "./study-config.js";

const COPILOT_369_SIDECAR_CHECKSUM = "1837bc7a8cbd366349c8bc207cc236a0dec9d0b04f7f63325ee525884faf3f3a";
const VALIDATION_30_CSV_FILENAME = "validation-30-cards.csv";
const VALIDATION_30_MANIFEST_FILENAME = "validation-30-cards.manifest.json";
const VALIDATION_30_SOURCE_CHECKSUM = "1607cfe84cb687a2cc7b4c56d3e0abf106b1a1044810d7390663ef1d691b63ab";
const VALIDATION_30_MANIFEST_CHECKSUM = "5049b9357468ce98bd4f83057ea3e59178a5d03793f97800252d7e3e87e7dc1a";

const readStudyBootstrapInput = async ({csvPath, configInput, manifestFile, manifestFd}) => {
    const config = assertNormalStudyConfig(await readStudyConfig(configInput));
    const credentialManifest = await readCredentialManifest({file: manifestFile, fd: manifestFd}, config);
    if (config.studyKey === "pr-card-sorting-local") {
        const expectedManifestPath = path.join(path.dirname(csvPath), COPILOT_369_MANIFEST_FILENAME);
        if (path.basename(csvPath) !== COPILOT_369_CANONICAL_FILENAME) {
            throw new Error("Copilot369 source input rejected (NON_CANONICAL_PATH)");
        }
        const sidecarChecksum = createHash("sha256").update(await readFile(expectedManifestPath)).digest("hex");
        if (sidecarChecksum !== COPILOT_369_SIDECAR_CHECKSUM) {
            throw new Error("Copilot369 source input rejected (MANIFEST_CHECKSUM_MISMATCH)");
        }
        try {
            const {cards, sourceChecksum, report} = await readCopilot369Cards(csvPath, {manifestPath: expectedManifestPath});
            return {cards, config, credentialManifest, sourceChecksum, report};
        } catch (error) {
            if (error instanceof Copilot369SourceError) {
                throw new Error(`Copilot369 source input rejected (${error.code})`);
            }
            throw error;
        }
    }

    const expectedManifestPath = path.join(path.dirname(csvPath), VALIDATION_30_MANIFEST_FILENAME);
    if (path.basename(csvPath) !== VALIDATION_30_CSV_FILENAME) {
        throw new Error("Validation30 source input rejected (NON_CANONICAL_PATH)");
    }
    const validationManifestChecksum = createHash("sha256").update(await readFile(expectedManifestPath)).digest("hex");
    if (validationManifestChecksum !== VALIDATION_30_MANIFEST_CHECKSUM) {
        throw new Error("Validation30 source input rejected (MANIFEST_CHECKSUM_MISMATCH)");
    }
    const {cards, errors, sourceChecksum} = await readPullRequestCards(csvPath, {
        expectedCardCount: config.expectedCardCount,
    });
    if (sourceChecksum !== VALIDATION_30_SOURCE_CHECKSUM) {
        throw new Error("Validation30 source input rejected (CSV_CHECKSUM_MISMATCH)");
    }
    if (errors.length > 0) throw new Error("CSV validation failed");
    return {cards, config, credentialManifest, sourceChecksum, report: null};
};

export {readStudyBootstrapInput};
