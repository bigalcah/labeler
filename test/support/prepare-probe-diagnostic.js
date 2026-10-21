import {readFileSync} from "node:fs";

const expectedMarkers = Object.freeze({
    "absent-context": "Initialization requires the locked host's root-owned pending handoff",
    "forged-context": "Untrusted release context path.",
});
const categories = Object.freeze({
    profileValidation: /STUDY_PROFILES_INPUT_INVALID|STUDY_PROFILES_INPUT.*(?:invalid|unreadable|valid JSON)/,
    containerStartOrMount: /Error response from daemon:|Mounts denied|failed to create task|error while creating mount source path|invalid mount config|OCI runtime create failed/i,
    databaseOrReadinessPrerequisite: /Readiness requires explicit database identity|STUDY_READINESS_FAILED|ECONNREFUSED|ECONNRESET|ETIMEDOUT|password authentication failed|could not connect to server|connection terminated|database .* does not exist|database system (?:is starting up|is not ready)/i,
});

const [probe, statusText] = process.argv.slice(2);
const marker = expectedMarkers[probe];
const status = Number(statusText);
if (!marker || !Number.isInteger(status) || status < 0) {
    process.stderr.write("Invalid prepare-probe diagnostic invocation.\n");
    process.exitCode = 2;
} else {
    const output = readFileSync(0);
    const decodedOutput = output.toString("utf8");
    const knownMarkerPresent = decodedOutput.includes(marker);
    const diagnostic = {
        probe,
        status,
        byteCount: output.byteLength,
        knownMarkerPresent,
        errorCategories: {
            profileValidation: categories.profileValidation.test(decodedOutput),
            containerStartOrMount: categories.containerStartOrMount.test(decodedOutput),
            databaseOrReadinessPrerequisite: categories.databaseOrReadinessPrerequisite.test(decodedOutput),
            capturedMarkerMismatch: !knownMarkerPresent,
        },
    };
    process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
}
