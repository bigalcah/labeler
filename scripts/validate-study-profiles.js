import {readStudyProfilesInput} from "../util/study-profiles-input.js";

try {
    await readStudyProfilesInput(process.env.STUDY_PROFILES_INPUT);
    process.stdout.write("STUDY_PROFILES_INPUT_VALID\n");
} catch (_error) {
    process.stderr.write("STUDY_PROFILES_INPUT_INVALID\n");
    process.exitCode = 1;
}
