import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {appendFile, chmod, cp, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {createReadinessProfiles} from "../readiness-fixture.js";
import {setSyntheticInputOwner} from "./container-input-staging.js";
import {stageReadinessContainerInputs} from "./readiness-container-inputs.js";
import {stageMaintenanceReaderInputs} from "./real-maintenance-entrypoint.js";

const execute = promisify(execFile);
const root = path.resolve(new URL("../..", import.meta.url).pathname);
const image = process.env.LABELER_READINESS_TEST_IMAGE;
const helperImage = "python:3.12-alpine";
const metadata = async file => {
    const value = await stat(file);
    return {uid: value.uid, gid: value.gid, mode: value.mode & 0o777};
};
const record = async value => {
    const directory = process.env.LABELER_READER_BOUNDARY_EVIDENCE_DIR;
    if (directory) await appendFile(path.join(directory, "reader-proofs.jsonl"), `${JSON.stringify(value)}\n`, {mode: 0o600});
};
const probeProfiles = async files => {
    const targets = {config: "/run/config/studies", accountManifest: "/run/secrets/studies", csv: "/labeling/data",
        descriptor: "/run/config/study-profiles.json", password: "/run/secrets/database-password"};
    const script = `import {readFile,stat} from "node:fs/promises";
import {readSecretFile} from "./util/secret-file.js";
import {readStudyProfilesInput} from "./util/study-profiles-input.js";
const result={uid:process.getuid(),gid:process.getgid(),profiles:0,password:false,files:[]};
try{result.profiles=(await readStudyProfilesInput("/run/config/study-profiles.json")).length}catch(error){result.profileError=error.name}
try{readSecretFile("/run/secrets/database-password","DATABASE_PASS_FILE");result.password=true}catch(error){result.passwordError=error.code}
for(const file of ["/run/config/study-profiles.json","/run/secrets/database-password","/run/config/studies/0.json","/run/secrets/studies/0.json","/labeling/data/copilot-369-cards.csv"]){const value=await stat(file);result.files.push({uid:value.uid,gid:value.gid,mode:value.mode&511});}
try{result.refreshed=(await readFile("/run/secrets/database-password","utf8")).length===30}catch(_error){result.refreshed=false}
console.log(JSON.stringify(result));`;
    const result = await execute("docker", ["run", "--rm", "--network", "none", "--read-only", "--user", "1000:1000", "--cap-drop", "ALL",
        "--mount", `type=bind,src=${path.join(root, "util")},dst=/labeling/util,readonly`,
        ...Object.entries(targets).flatMap(([kind, target]) => ["--mount", `type=bind,src=${files[kind]},dst=${target},readonly`]),
        "--entrypoint", "node", image, "--input-type=module", "--eval", script]);
    return JSON.parse(result.stdout);
};

test("readiness readers stage foreign private inputs after rewrites and refresh mutations under umask 077", async () => {
    const priorMask = process.umask(0o077);
    const fixture = await createReadinessProfiles();
    const foreign = await mkdtemp(path.join(tmpdir(), "readiness-foreign-readers-"));
    try {
        await cp(fixture.root, foreign, {recursive: true});
        const descriptor = path.join(foreign, "mounted-profiles.json");
        const password = path.join(foreign, "database-password");
        await writeFile(descriptor, JSON.stringify({profiles: fixture.profiles.map((profile, index) => ({
            config: `/run/config/studies/${index}.json`, accountManifest: `/run/secrets/studies/${index}.json`,
            csv: `/labeling/data/${path.basename(profile.csvPath)}`, enrichmentEnabled: false,
        }))}));
        await writeFile(password, "SYNTHETIC_BOUNDARY_PASSWORD\n", {mode: 0o400});
        const originals = ["mounted-profiles.json", "database-password", "config/0.json", "config/1.json",
            "accountManifest/0.json", "accountManifest/1.json", "csv/copilot-369-cards.csv", "csv/copilot-369-cards.manifest.json",
            "csv/validation-30-cards.csv", "csv/validation-30-cards.manifest.json"];
        for (const file of originals) await chmod(path.join(foreign, file), 0o400);
        await setSyntheticInputOwner({fixtureDirectory: foreign, relativePaths: originals, uid: 21001, gid: 21001, helperImage});
        const red = await probeProfiles({config: path.join(foreign, "config"), accountManifest: path.join(foreign, "accountManifest"),
            csv: path.join(foreign, "csv"), descriptor, password});
        assert.equal(red.profiles, 0);
        assert.equal(red.passwordError, "SECRET_FILE_INVALID");
        const staged = await stageReadinessContainerInputs({fixtureRoot: foreign, descriptor, password});
        const green = await probeProfiles(staged);
        assert.equal(green.profiles, 2);
        assert.equal(green.password, true);
        assert.ok(green.files.every(value => value.uid === 1000 && value.gid === 1000 && value.mode === 0o400));
        assert.equal((await metadata(path.dirname(staged.password))).mode, 0o700);
        for (const kind of ["config", "csv", "accountManifest"]) assert.equal((await metadata(staged[kind])).mode, 0o711);
        const ownerRead = await execute("docker", ["run", "--rm", "--network", "none", "--read-only", "--user", "21001:21001", "--cap-drop", "ALL",
            ...originals.flatMap((file, index) => ["--mount", `type=bind,src=${path.join(foreign, file)},dst=/proof/${index},readonly`]),
            helperImage, "python3", "-B", "-c", "from pathlib import Path;import json,os;files=list(Path('/proof').iterdir());[file.read_bytes() for file in files];print(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'readCount':len(files)}))"]);
        assert.equal(JSON.parse(ownerRead.stdout).readCount, originals.length);
        for (const profile of fixture.profiles) await readFile(profile.accountManifest);
        await setSyntheticInputOwner({fixtureDirectory: foreign, relativePaths: ["database-password"], uid: process.getuid(), gid: process.getgid(), helperImage});
        await chmod(password, 0o600);
        await writeFile(password, "SYNTHETIC_REFRESHED_PASSWORD!!");
        await chmod(password, 0o400);
        const refreshed = await probeProfiles(await stageReadinessContainerInputs({fixtureRoot: foreign, descriptor, password}));
        assert.equal(refreshed.refreshed, true);
        await record({kind: "readiness", umask: "0077", red, green, refreshed,
            controlledOwnerRead: JSON.parse(ownerRead.stdout), hostOriginalReadable: true,
            originalManifest: await metadata(fixture.profiles[0].accountManifest)});
    } finally {
        process.umask(priorMask);
        await rm(foreign, {recursive: true, force: true});
        await rm(fixture.root, {recursive: true, force: true});
    }
});

test("maintenance copies admit host GID and Node owner readers without exposing passwords or changing originals", async () => {
    const priorMask = process.umask(0o077);
    const directory = await mkdtemp(path.join(tmpdir(), "maintenance-reader-proof-"));
    try {
        const envMetadata = {LABELER_READINESS_TEST_IMAGE: image, REPOSITORY_ROOT: root, LABELER_TEST_NETWORK: "isolated-reader-proof"};
        const envFile = path.join(directory, "runtime.env");
        const envBody = Object.entries(envMetadata).map(([key, value]) => `${key}=${value}\n`).join("");
        await writeFile(envFile, envBody, {mode: 0o400});
        await writeFile(path.join(directory, "database-password"), "SYNTHETIC_PRIVATE_MAINTENANCE\n", {mode: 0o400});
        await writeFile(path.join(directory, "cutover-request.json"), JSON.stringify({confirmation: "cutover-primary-300-to-copilot-369",
            database: {passwordFile: path.join(directory, "container-inputs/database-password")}}), {mode: 0o400});
        await assert.rejects(stageMaintenanceReaderInputs({directory, metadata: {...envMetadata, PGPASSWORD: "forbidden"}}));
        const canary = "SYNTHETIC_ENV_BODY_PRIVATE_CANARY";
        await chmod(envFile, 0o600);
        await writeFile(envFile, envBody.replace(image, canary));
        await chmod(envFile, 0o400);
        const invalid = await execute(process.execPath, ["--input-type=module", "--eval",
            `import {inspect} from "node:util";
import {stageMaintenanceReaderInputs} from ${JSON.stringify(new URL("./real-maintenance-entrypoint.js", import.meta.url).href)};
try{await stageMaintenanceReaderInputs(JSON.parse(process.argv[1]));process.stdout.write(JSON.stringify({rejected:false}));}
catch(error){process.stdout.write(JSON.stringify({rejected:true,diagnostic:inspect(error,{depth:null})}));}`,
            JSON.stringify({directory, metadata: envMetadata})]);
        assert.equal(JSON.parse(invalid.stdout).rejected, true);
        assert.equal((invalid.stdout + invalid.stderr).includes(canary), false, "Private env content must not appear in rejection diagnostics or output");
        await assert.rejects(stat(path.join(directory, "container-inputs")), {code: "ENOENT"});
        await chmod(envFile, 0o600);
        await writeFile(envFile, envBody);
        await chmod(envFile, 0o400);
        await record({kind: "maintenance-safe-error", rejected: true, canaryInDiagnosticsOrOutput: false, invalidCopyCreated: false});
        const staged = await stageMaintenanceReaderInputs({directory, metadata: envMetadata});
        const hostProof = `import json,os,sys
from pathlib import Path
sys.path.insert(0,'/host-code')
from runtime import Runtime
runtime=Runtime(Path('/unused-state'))
request=runtime.external('/proof/request.json');value=json.loads(request.read_text())
password=runtime.external('/proof/password')
try:
 password.read_bytes();password_read=True
except PermissionError:
 password_read=False
print(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'envRead':bool(runtime.env_file.read_bytes()),'requestRead':value['confirmation']=='cutover-primary-300-to-copilot-369','passwordMetadataAccepted':True,'passwordRead':password_read}))`;
        const host = JSON.parse((await execute("docker", ["run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
            "--user", `21001:${process.getgid()}`, "--mount", `type=bind,src=${path.join(root, "deployment/host")},dst=/host-code,readonly`,
            "--mount", `type=bind,src=${staged.envFile},dst=/proof/runtime.env,readonly`,
            "--mount", `type=bind,src=${staged.requestPath},dst=/proof/request.json,readonly`,
            "--mount", `type=bind,src=${staged.passwordPath},dst=/proof/password,readonly`,
            "-e", "LABELER_ENV_FILE=/proof/runtime.env", "-e", "LABELER_PUBLIC_BASE_URL=https://localhost",
            helperImage, "python3", "-B", "-c", hostProof])).stdout);
        assert.deepEqual(host, {uid: 21001, gid: process.getgid(), envRead: true, requestRead: true, passwordMetadataAccepted: true, passwordRead: false});
        const node = JSON.parse((await execute("docker", ["run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--user", "1000:1000",
            "--mount", `type=bind,src=${staged.requestPath},dst=/proof/request.json,readonly`,
            "--mount", `type=bind,src=${staged.passwordPath},dst=${staged.passwordPath},readonly`,
            "--mount", `type=bind,src=${path.join(root, "util")},dst=/labeling/util,readonly`,
            "--entrypoint", "node", image, "--input-type=module", "--eval",
            "import {readFileSync} from 'node:fs';import {readSecretFile} from './util/secret-file.js';const request=JSON.parse(readFileSync('/proof/request.json','utf8'));console.log(JSON.stringify({uid:process.getuid(),requestRead:!!request.confirmation,passwordRead:!!readSecretFile(request.database.passwordFile,'DATABASE_PASS_FILE')}))"])).stdout);
        assert.deepEqual(node, {uid: 1000, requestRead: true, passwordRead: true});
        const originals = await Promise.all(["runtime.env", "cutover-request.json", "database-password"].map(async name => {
            await readFile(path.join(directory, name));
            return metadata(path.join(directory, name));
        }));
        assert.ok(originals.every(value => value.uid === process.getuid() && value.mode === 0o400));
        const copies = await Promise.all([staged.envFile, staged.requestPath, staged.passwordPath].map(metadata));
        assert.deepEqual(copies, [{uid: 1000, gid: 1000, mode: 0o444}, {uid: 1000, gid: process.getgid(), mode: 0o440}, {uid: 1000, gid: 1000, mode: 0o400}]);
        assert.equal((await metadata(directory)).mode, 0o700);
        assert.equal((await metadata(path.dirname(staged.envFile))).mode, 0o700);
        await record({kind: "maintenance", umask: "0077", host, node, originals, copies, envKeys: Object.keys(envMetadata)});
    } finally {
        process.umask(priorMask);
        await rm(directory, {recursive: true, force: true});
    }
});
