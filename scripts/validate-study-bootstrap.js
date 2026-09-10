import {readStudyBootstrapInput} from "../util/study-bootstrap-input.js";

const argumentsList = process.argv.slice(2);
const [csvPath, configInput] = argumentsList;

if (argumentsList.length < 1 || argumentsList.length > 2 || !csvPath) {
    process.stderr.write("STUDY_BOOTSTRAP_INPUT_INVALID\n");
    process.exitCode = 1;
} else {
    try {
        await readStudyBootstrapInput({
            csvPath,
            configInput,
            manifestFile: process.env.STUDY_ACCOUNT_MANIFEST_FILE,
            manifestFd: process.env.STUDY_ACCOUNT_MANIFEST_FD === undefined
                ? undefined
                : Number(process.env.STUDY_ACCOUNT_MANIFEST_FD),
        });
        process.stdout.write("STUDY_BOOTSTRAP_INPUT_VALID\n");
    } catch (_error) {
        process.stderr.write("STUDY_BOOTSTRAP_INPUT_INVALID\n");
        process.exitCode = 1;
    }
}
