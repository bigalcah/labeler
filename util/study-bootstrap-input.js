import {readPullRequestCards} from "./csv-pr-provider.js";
import {readCredentialManifest} from "./credential-manifest.js";
import {readStudyConfig} from "./study-config.js";

const readStudyBootstrapInput = async ({csvPath, configInput, manifestFile, manifestFd}) => {
    const config = await readStudyConfig(configInput);
    const credentialManifest = await readCredentialManifest({file: manifestFile, fd: manifestFd}, config);
    const {cards, errors, sourceChecksum} = await readPullRequestCards(csvPath, {
        expectedCardCount: config.expectedCardCount,
    });
    if (errors.length > 0) throw new Error("CSV validation failed");
    return {cards, config, credentialManifest, sourceChecksum};
};

export {readStudyBootstrapInput};
