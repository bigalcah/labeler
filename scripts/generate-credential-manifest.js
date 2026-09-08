import {readStudyConfig} from "../util/study-config.js";
import {createPasswordHash} from "../util/credential-policy.js";
import {writeCredentialManifest} from "../util/credential-manifest.js";
import {readPasswords} from "../util/credential-input.js";
import {parseCredentialOptions} from "../util/credential-cli.js";

try {
    const options = parseCredentialOptions(process.argv.slice(2), {
        required: [ "--study-config", "--output" ],
        optional: [ "--password-fd" ],
    });
    const configInput = options["--study-config"];
    const output = options["--output"];
    const passwordFd = options["--password-fd"] || "0";
    if (!configInput || !output || !/^\d+$/.test(passwordFd)) throw new Error("invalid");
    const config = await readStudyConfig(configInput);
    const passwords = await readPasswords(Number(passwordFd), config.participants.length);
    const manifest = {
        manifestVersion: 1,
        studyKey: config.studyKey,
        accounts: await Promise.all(config.participants.map(async (participantKey, index) => ({
            participantKey,
            normalizedUsername: participantKey.toLowerCase(),
            passwordHash: await createPasswordHash(passwords[index]),
        }))),
    };
    await writeCredentialManifest(output, manifest, config);
    process.stdout.write("CREDENTIAL_MANIFEST_CREATED\n");
} catch (_error) {
    process.stderr.write("CREDENTIAL_MANIFEST_FAILED\n");
    process.exitCode = 1;
}
