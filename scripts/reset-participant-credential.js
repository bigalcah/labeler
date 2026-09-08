import pool from "../util/pg-pool.js";
import {readPasswords} from "../util/credential-input.js";
import {resetParticipantCredential} from "../util/credential-accounts.js";
import {parseCredentialOptions} from "../util/credential-cli.js";

try {
    const options = parseCredentialOptions(process.argv.slice(2), {
        required: [ "--study-key", "--participant-key" ],
        optional: [ "--password-fd" ],
    });
    const studyKey = options["--study-key"];
    const participantKey = options["--participant-key"];
    const passwordFd = options["--password-fd"] || "0";
    if (!studyKey || !participantKey || !/^\d+$/.test(passwordFd)) throw new Error("invalid");
    const [password] = await readPasswords(Number(passwordFd), 1);
    await resetParticipantCredential({pool, studyKey, participantKey, password});
    process.stdout.write("CREDENTIAL_RESET_COMPLETED\n");
} catch (_error) {
    process.stderr.write("CREDENTIAL_RESET_FAILED\n");
    process.exitCode = 1;
} finally {
    await pool.end();
}
