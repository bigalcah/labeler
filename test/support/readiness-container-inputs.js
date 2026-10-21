import {readdir} from "node:fs/promises";
import path from "node:path";
import {stageNodeContainerInputs} from "./container-input-staging.js";

const stageReadinessContainerInputs = async ({fixtureRoot, descriptor, password}) => {
    const kinds = ["config", "accountManifest", "csv"];
    const inputMappings = [];
    for (const kind of kinds) {
        for (const name of await readdir(path.join(fixtureRoot, kind))) {
            inputMappings.push({source: path.join(kind, name), destination: path.join(kind, name)});
        }
    }
    inputMappings.push({source: path.relative(fixtureRoot, descriptor), destination: "descriptor.json"});
    const staged = await stageNodeContainerInputs({sourceDirectory: fixtureRoot, destinationDirectory: fixtureRoot,
        inputMappings, helperImage: "python:3.12-alpine"});
    await stageNodeContainerInputs({sourceDirectory: path.dirname(password), destinationDirectory: fixtureRoot,
        inputMappings: [{source: path.basename(password), destination: "password"}], helperImage: "python:3.12-alpine"});
    return {...Object.fromEntries(kinds.map(kind => [kind, path.join(staged, kind)])),
        descriptor: path.join(staged, "descriptor.json"), password: path.join(staged, "password")};
};

export {stageReadinessContainerInputs};
