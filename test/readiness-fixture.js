import {chmod, copyFile, mkdir, mkdtemp, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createPasswordHash} from "../util/credential-policy.js";
import {readStudyProfilesInput} from "../util/study-profiles-input.js";

const createReadinessProfiles = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "labeler-readiness-"));
    const roots = Object.fromEntries(["descriptor", "config", "csv", "accountManifest"].map(key => [key, path.join(root, key)]));
    await Promise.all(Object.values(roots).map(directory => mkdir(directory)));
    const passwordHash = await createPasswordHash("disposable-readiness-only-password");
    const descriptor = {profiles: []};
    for (const [index, count] of [369, 30].entries()) {
        const name = count === 369 ? "copilot-369-cards" : "validation-30-cards";
        for (const suffix of ["csv", "manifest.json"]) {
            await copyFile(new URL(`../plans/${name}.${suffix}`, import.meta.url), path.join(roots.csv, `${name}.${suffix}`));
        }
        const studyKey = count === 369 ? "pr-card-sorting-local" : "pr-card-sorting-validation-30";
        const participants = ["javier", "diego", "pablo"];
        const loginUsernames = Object.fromEntries(participants.map(key => [key, `${key}${count === 30 ? "-30" : ""}`]));
        const config = path.join(roots.config, `${index}.json`);
        const accountManifest = path.join(roots.accountManifest, `${index}.json`);
        await writeFile(config, JSON.stringify({studyKey, expectedCardCount: count, participants, loginUsernames}));
        await writeFile(accountManifest, JSON.stringify({manifestVersion: 1, studyKey,
            accounts: participants.map(participantKey => ({participantKey, normalizedUsername: loginUsernames[participantKey], passwordHash}))}));
        await chmod(accountManifest, 0o400);
        descriptor.profiles.push({config, csv: path.join(roots.csv, `${name}.csv`), accountManifest, enrichmentEnabled: false});
    }
    const descriptorPath = path.join(roots.descriptor, "profiles.json");
    await writeFile(descriptorPath, JSON.stringify(descriptor));
    return {root, profiles: await readStudyProfilesInput(descriptorPath, roots)};
};

export {createReadinessProfiles};
