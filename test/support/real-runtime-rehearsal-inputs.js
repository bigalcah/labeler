import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, stat} from "node:fs/promises";
import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import {setSyntheticInputOwner, stageNodeContainerInputs} from "./container-input-staging.js";
import {docker} from "./real-runtime-rehearsal-fixture.js";

const inputNames = ["database-password", "inspection-password", "session-current", "session-previous", "descriptor.json", "legacy.csv"];

const stageRehearsalInputs = async fixture => {
    const helperImage = "python:3.12-alpine";
    for (const selector of ["-u", "-g"]) {
        assert.equal((await docker(["run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL",
            "--entrypoint", "id", fixture.images.server, selector])).trim(), "1000", "Node consumption must remain unprivileged UID/GID 1000");
    }
    fixture.nodeInputs = await stageNodeContainerInputs({sourceDirectory: fixture.directory, destinationDirectory: fixture.directory,
        inputMappings: [...inputNames, "pg-password"].map(name => ({source: name, destination: name})), helperImage});
    await stageNodeContainerInputs({sourceDirectory: fixture.profileRoot, destinationDirectory: fixture.directory,
        inputMappings: fixture.profiles.flatMap((profile, index) => ["config", "accountManifest"].map(key => ({
            source: path.relative(fixture.profileRoot, profile[key]), destination: `profiles/${index}-${key}.json` }))), helperImage});
    fixture.databaseReader = {};
    for (const [key, selector] of [["uid", "-u"], ["gid", "-g"]]) {
        fixture.databaseReader[key] = Number((await docker(["run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL",
            "--entrypoint", "id", fixture.images.database, selector, "postgres"])).trim());
        assert.ok(Number.isSafeInteger(fixture.databaseReader[key]) && fixture.databaseReader[key] > 0);
    }
    await setSyntheticInputOwner({fixtureDirectory: fixture.nodeInputs, relativePaths: ["pg-password"],
        ...fixture.databaseReader, helperImage});
};

const readOriginalInputs = async fixture => JSON.parse(await docker(["run", "--rm", "--pull", "never", "--network", "none", "--read-only",
    "--cap-drop", "ALL", "--user", `${fixture.foreignOwner}:${fixture.foreignOwner}`,
    ...fixture.originalPaths.flatMap((source, index) => ["--mount", `type=bind,src=${source},dst=/inputs/${index},readonly`]),
    "--entrypoint", "node", fixture.images.server, "--input-type=module", "--eval",
    `import fs from 'node:fs';import {createHash} from 'node:crypto';
    console.log(JSON.stringify(Array.from({length:${fixture.originalPaths.length}},(_,index)=>{
        const file='/inputs/'+index;const value=fs.statSync(file);
        return {uid:value.uid,gid:value.gid,mode:value.mode&511,inode:value.ino,
            sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')};})));`]));

const challengeRehearsalInputs = async fixture => {
    fixture.foreignOwner = process.getuid() === 1001 ? 1002 : 1001;
    const names = [...inputNames, "pg-password", "production.env", "Caddyfile"];
    fixture.originalPaths = [...names.map(name => path.join(fixture.directory, name)),
        ...fixture.profiles.flatMap(profile => [profile.config, profile.accountManifest])];
    const before = await Promise.all(fixture.originalPaths.map(async source => {
        const metadata = await stat(source);
        assert.equal(metadata.mode & 0o777, ["production.env", "Caddyfile"].includes(path.basename(source)) ? 0o444 : 0o400);
        return {mode: metadata.mode & 0o777, inode: metadata.ino, sha256: createHash("sha256").update(await readFile(source)).digest("hex")};
    }));
    for (const [directory, relativePaths] of [[fixture.directory, names], [fixture.profileRoot,
        fixture.profiles.flatMap(profile => [profile.config, profile.accountManifest].map(source => path.relative(fixture.profileRoot, source)))]]) {
        await setSyntheticInputOwner({fixtureDirectory: directory, relativePaths, uid: fixture.foreignOwner, gid: fixture.foreignOwner,
            helperImage: "python:3.12-alpine"});
    }
    fixture.originalInputs = await readOriginalInputs(fixture);
    assert.equal(isDeepStrictEqual(fixture.originalInputs, before.map(value => ({uid: fixture.foreignOwner, gid: fixture.foreignOwner, ...value}))),
        true, "host original input challenge must preserve metadata and content");
};

const assertRehearsalInputsPreserved = async fixture => {
    assert.equal(isDeepStrictEqual(await readOriginalInputs(fixture), fixture.originalInputs),
        true, "host originals must retain identity, privacy and owner readability");
    return {foreignOwner: fixture.foreignOwner, originalFiles: fixture.originalInputs.length, originalInputsPreserved: true,
        nodeReader: 1000, databaseReader: fixture.databaseReader};
};

export {assertRehearsalInputsPreserved, challengeRehearsalInputs, stageRehearsalInputs};
