import path from "node:path";
import {fileURLToPath} from "node:url";
import {
    COPILOT_369_CANONICAL_FILENAME,
    COPILOT_369_MANIFEST_FILENAME,
    prepareCopilot369Source,
} from "../util/copilot-369-source.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = "/home/javier/Descargas/practica2/muestras_def";
const result = await prepareCopilot369Source({
    sourcePath: path.join(sourceDirectory, "muestra_copilot.csv"),
    sourceManifestPath: path.join(sourceDirectory, "manifest.json"),
    outputCsvPath: path.join(projectRoot, "plans", COPILOT_369_CANONICAL_FILENAME),
    manifestPath: path.join(projectRoot, "plans", COPILOT_369_MANIFEST_FILENAME),
});

process.stdout.write(`${JSON.stringify({
    csv: COPILOT_369_CANONICAL_FILENAME,
    cards: result.cards.length,
    sourceChecksum: result.sourceChecksum,
    omissions: result.report.omissions.map(({field, reason, count}) => ({field, reason, count})),
})}\n`);
