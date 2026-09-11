import {readFile, realpath, stat} from "node:fs/promises";
import path from "node:path";
import {readStudyBootstrapInput} from "./study-bootstrap-input.js";

const PROFILE_CONTRACTS = Object.freeze([
    Object.freeze({
        studyKey: "pr-card-sorting-local",
        expectedCardCount: 300,
        sourceChecksum: "4051c10c39a1634aa80d9018aa53b59fd6009fdc4d7f2526d5e73708b02f53ef",
        participants: Object.freeze([ "javier", "diego", "pablo" ]),
        loginUsernames: Object.freeze({javier: "javier", diego: "diego", pablo: "pablo"}),
    }),
    Object.freeze({
        studyKey: "pr-card-sorting-validation-30",
        expectedCardCount: 30,
        sourceChecksum: "1607cfe84cb687a2cc7b4c56d3e0abf106b1a1044810d7390663ef1d691b63ab",
        participants: Object.freeze([ "javier", "diego", "pablo" ]),
        loginUsernames: Object.freeze({javier: "javier-30", diego: "diego-30", pablo: "pablo-30"}),
    }),
]);

const DEFAULT_PROFILE_ROOTS = Object.freeze({
    descriptor: "/run/config",
    config: "/run/config/studies",
    csv: "/labeling/plans",
    accountManifest: "/run/secrets/studies",
});

class StudyProfilesInputError extends Error {
    constructor(message) {
        super(message);
        this.name = "StudyProfilesInputError";
    }
}

const assertExactKeys = (value, expected, label) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
        throw new StudyProfilesInputError(`${label} has an invalid shape`);
    }
};

const resolveMountedFile = async ({file, root, label}) => {
    if (typeof file !== "string" || !path.isAbsolute(file) || file.includes("\0")) {
        throw new StudyProfilesInputError(`${label} must be an absolute mounted file path`);
    }
    try {
        const [ resolvedFile, resolvedRoot ] = await Promise.all([realpath(file), realpath(root)]);
        const relative = path.relative(resolvedRoot, resolvedFile);
        if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error();
        if (!(await stat(resolvedFile)).isFile()) throw new Error();
        return resolvedFile;
    } catch (_error) {
        throw new StudyProfilesInputError(`${label} is outside its approved mounted root or is unreadable`);
    }
};

const readDescriptor = async (input, roots) => {
    const descriptorFile = await resolveMountedFile({file: input, root: roots.descriptor, label: "STUDY_PROFILES_INPUT"});
    try {
        return JSON.parse(await readFile(descriptorFile, "utf8"));
    } catch (_error) {
        throw new StudyProfilesInputError("STUDY_PROFILES_INPUT must contain valid JSON");
    }
};

const readStudyProfilesInput = async (input, roots = DEFAULT_PROFILE_ROOTS) => {
    const descriptor = await readDescriptor(input, roots);
    assertExactKeys(descriptor, [ "profiles" ], "Study profiles descriptor");
    if (!Array.isArray(descriptor.profiles) || descriptor.profiles.length !== PROFILE_CONTRACTS.length) {
        throw new StudyProfilesInputError("Study profiles descriptor must contain the ordered 300 and 30 profiles");
    }

    const results = await Promise.allSettled(descriptor.profiles.map(async (entry, index) => {
        assertExactKeys(entry, [ "config", "csv", "accountManifest", "enrichmentEnabled" ], `profiles[${index}]`);
        if (typeof entry.enrichmentEnabled !== "boolean") {
            throw new StudyProfilesInputError(`profiles[${index}].enrichmentEnabled must be boolean`);
        }
        const [ configInput, csvPath, manifestFile ] = await Promise.all([
            resolveMountedFile({file: entry.config, root: roots.config, label: `profiles[${index}].config`}),
            resolveMountedFile({file: entry.csv, root: roots.csv, label: `profiles[${index}].csv`}),
            resolveMountedFile({file: entry.accountManifest, root: roots.accountManifest, label: `profiles[${index}].accountManifest`}),
        ]);
        const bootstrapInput = await readStudyBootstrapInput({csvPath, configInput, manifestFile});
        const contract = PROFILE_CONTRACTS[index];
        if (bootstrapInput.config.studyKey !== contract.studyKey
            || bootstrapInput.config.expectedCardCount !== contract.expectedCardCount
            || JSON.stringify(bootstrapInput.config.participants) !== JSON.stringify(contract.participants)
            || JSON.stringify(bootstrapInput.config.loginUsernames) !== JSON.stringify(contract.loginUsernames)
            || bootstrapInput.sourceChecksum !== contract.sourceChecksum) {
            throw new StudyProfilesInputError(`profiles[${index}] does not match the approved ordered profile`);
        }
        return Object.freeze({...entry, configInput, csvPath, manifestFile, bootstrapInput});
    }));
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
    const profiles = results.map(result => result.value);

    if (new Set(profiles.map(profile => profile.bootstrapInput.config.studyKey)).size !== profiles.length) {
        throw new StudyProfilesInputError("Study profile keys must be unique");
    }
    return Object.freeze(profiles);
};

export {DEFAULT_PROFILE_ROOTS, StudyProfilesInputError, readStudyProfilesInput};
