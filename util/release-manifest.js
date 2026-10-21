import {TextDecoder} from "node:util";

const MAX_RELEASE_NUMBER = 2_147_483_647;
const ROOT_KEYS = [
    "schemaVersion",
    "releaseId",
    "generation",
    "commit",
    "images",
    "dataBundle",
    "schemaCompatibility",
    "dataCompatibility",
    "workflow",
    "createdAt",
];
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const RELEASE_ID_PATTERN = /^(0|[1-9][0-9]{0,9})-([1-9][0-9]{0,9})-([a-f0-9]{40})$/;
const IMAGE_PATTERN = /^ghcr\.io\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+:sha-([a-f0-9]{40})@sha256:([a-f0-9]{64})$/;
const WORKFLOW_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const CREATED_AT_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z$/;
const NUMBER_PATTERN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const CANONICAL_PROFILES = [
    {
        studyKey: "pr-card-sorting-local",
        expectedCardCount: 369,
        csv: {
            path: "/labeling/data/copilot-369-cards.csv",
            sha256: "fad0881b9e40b1b68a577e84ad60c90d48fcebe79db8d55d05613fc1746794fb",
        },
        manifest: {
            path: "/labeling/data/copilot-369-cards.manifest.json",
            sha256: "1837bc7a8cbd366349c8bc207cc236a0dec9d0b04f7f63325ee525884faf3f3a",
        },
    },
    {
        studyKey: "pr-card-sorting-validation-30",
        expectedCardCount: 30,
        csv: {
            path: "/labeling/data/validation-30-cards.csv",
            sha256: "1607cfe84cb687a2cc7b4c56d3e0abf106b1a1044810d7390663ef1d691b63ab",
        },
        manifest: {
            path: "/labeling/data/validation-30-cards.manifest.json",
            sha256: "5049b9357468ce98bd4f83057ea3e59178a5d03793f97800252d7e3e87e7dc1a",
        },
    },
];

class ReleaseManifestError extends Error {
    constructor(code) {
        super(code);
        this.name = "ReleaseManifestError";
        this.code = code;
    }
}

const fail = code => {
    throw new ReleaseManifestError(code);
};

const invalidManifest = () => fail("INVALID_MANIFEST");

const assertExactKeys = (value, expectedKeys) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) invalidManifest();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalidManifest();
    const ownKeys = Reflect.ownKeys(value);
    const expected = new Set(expectedKeys);
    if (ownKeys.length !== expectedKeys.length || ownKeys.some(key => typeof key !== "string" || !expected.has(key))) {
        invalidManifest();
    }
    for (const key of expectedKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) invalidManifest();
    }
};

const assertDenseArray = (value, expectedLength) => {
    if (!Array.isArray(value) || value.length !== expectedLength) invalidManifest();
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedLength + 1 || !ownKeys.includes("length")) invalidManifest();
    for (let index = 0; index < expectedLength; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) invalidManifest();
    }
};

const assertReleaseNumber = (value, minimum) => {
    if (!Number.isSafeInteger(value) || value < minimum || value > MAX_RELEASE_NUMBER) invalidManifest();
};

const assertImageReference = (value, commit) => {
    if (typeof value !== "string") invalidManifest();
    const match = value.match(IMAGE_PATTERN);
    if (!match || match[1] !== commit) invalidManifest();
};

const assertCompatibility = (value, token) => {
    assertExactKeys(value, ["produces", "applicationSupports"]);
    if (value.produces !== token) invalidManifest();
    assertDenseArray(value.applicationSupports, 1);
    if (value.applicationSupports[0] !== token) invalidManifest();
};

const assertCanonicalProfile = (value, expected) => {
    assertExactKeys(value, ["studyKey", "expectedCardCount", "csv", "manifest"]);
    if (value.studyKey !== expected.studyKey || value.expectedCardCount !== expected.expectedCardCount) {
        invalidManifest();
    }
    for (const artifactName of ["csv", "manifest"]) {
        assertExactKeys(value[artifactName], ["path", "sha256"]);
        if (value[artifactName].path !== expected[artifactName].path
            || value[artifactName].sha256 !== expected[artifactName].sha256) {
            invalidManifest();
        }
    }
};

const assertCreatedAt = value => {
    if (typeof value !== "string") invalidManifest();
    const match = value.match(CREATED_AT_PATTERN);
    if (!match) invalidManifest();
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== `${match[1]}.000Z`) invalidManifest();
};

const assertWorkflow = value => {
    if (typeof value !== "string" || !WORKFLOW_PATTERN.test(value) || /secret|password|token|credential|private[_-]?key/i.test(value)) {
        invalidManifest();
    }
};

export const validateReleaseManifest = manifest => {
    assertExactKeys(manifest, ROOT_KEYS);
    if (manifest.schemaVersion !== 2 || typeof manifest.commit !== "string" || !COMMIT_PATTERN.test(manifest.commit)) {
        invalidManifest();
    }
    assertReleaseNumber(manifest.generation, 0);
    const releaseMatch = typeof manifest.releaseId === "string" ? manifest.releaseId.match(RELEASE_ID_PATTERN) : null;
    if (!releaseMatch || Number(releaseMatch[1]) !== manifest.generation
        || Number(releaseMatch[2]) < 1 || Number(releaseMatch[2]) > MAX_RELEASE_NUMBER
        || releaseMatch[3] !== manifest.commit) {
        invalidManifest();
    }

    assertExactKeys(manifest.images, ["server", "database"]);
    assertImageReference(manifest.images.server, manifest.commit);
    assertImageReference(manifest.images.database, manifest.commit);

    assertExactKeys(manifest.dataBundle, ["profiles"]);
    assertDenseArray(manifest.dataBundle.profiles, CANONICAL_PROFILES.length);
    manifest.dataBundle.profiles.forEach((profile, index) => assertCanonicalProfile(profile, CANONICAL_PROFILES[index]));
    assertCompatibility(manifest.schemaCompatibility, "study-schema-3");
    assertCompatibility(manifest.dataCompatibility, "copilot369-v1");
    assertWorkflow(manifest.workflow);
    assertCreatedAt(manifest.createdAt);
    return manifest;
};

const parseRawJson = raw => {
    let text;
    try {
        if (typeof raw === "string") {
            text = raw;
        } else if (raw instanceof Uint8Array) {
            text = new TextDecoder("utf-8", {fatal: true}).decode(raw);
        } else {
            return fail("INVALID_JSON");
        }
    } catch {
        return fail("INVALID_JSON");
    }

    let offset = 0;
    const invalidJson = () => fail("INVALID_JSON");
    const skipWhitespace = () => {
        while (offset < text.length
            && [" ", "\t", "\n", "\r"].includes(text[offset])) offset += 1;
    };
    const parseString = () => {
        const start = offset;
        offset += 1;
        while (offset < text.length) {
            const character = text[offset];
            if (character === "\"") {
                offset += 1;
                try {
                    return JSON.parse(text.slice(start, offset));
                } catch {
                    return invalidJson();
                }
            }
            if (character === "\\") {
                offset += 2;
            } else {
                offset += 1;
            }
        }
        return invalidJson();
    };
    const parseValue = () => {
        skipWhitespace();
        const character = text[offset];
        if (character === "\"") return parseString();
        if (character === "{") {
            offset += 1;
            skipWhitespace();
            const object = {};
            if (text[offset] === "}") {
                offset += 1;
                return object;
            }
            while (offset < text.length) {
                skipWhitespace();
                if (text[offset] !== "\"") return invalidJson();
                const key = parseString();
                if (Object.hasOwn(object, key)) fail("DUPLICATE_JSON_KEY");
                skipWhitespace();
                if (text[offset] !== ":") return invalidJson();
                offset += 1;
                const value = parseValue();
                Object.defineProperty(object, key, {
                    value,
                    enumerable: true,
                    configurable: true,
                    writable: true,
                });
                skipWhitespace();
                if (text[offset] === "}") {
                    offset += 1;
                    return object;
                }
                if (text[offset] !== ",") return invalidJson();
                offset += 1;
            }
            return invalidJson();
        }
        if (character === "[") {
            offset += 1;
            skipWhitespace();
            const array = [];
            if (text[offset] === "]") {
                offset += 1;
                return array;
            }
            while (offset < text.length) {
                array.push(parseValue());
                skipWhitespace();
                if (text[offset] === "]") {
                    offset += 1;
                    return array;
                }
                if (text[offset] !== ",") return invalidJson();
                offset += 1;
            }
            return invalidJson();
        }
        for (const [literal, value] of [["true", true], ["false", false], ["null", null]]) {
            if (text.startsWith(literal, offset)) {
                offset += literal.length;
                return value;
            }
        }
        NUMBER_PATTERN.lastIndex = offset;
        const numberMatch = NUMBER_PATTERN.exec(text);
        if (numberMatch) {
            offset = NUMBER_PATTERN.lastIndex;
            return Number(numberMatch[0]);
        }
        return invalidJson();
    };

    const result = parseValue();
    skipWhitespace();
    if (offset !== text.length) invalidJson();
    return result;
};

export const parseReleaseManifest = raw => validateReleaseManifest(parseRawJson(raw));

export const createReleaseManifest = input => {
    assertExactKeys(input, [
        "generation", "attempt", "commit", "serverImage", "databaseImage", "workflow", "createdAt",
    ]);
    assertReleaseNumber(input.generation, 0);
    assertReleaseNumber(input.attempt, 1);
    if (typeof input.commit !== "string" || !COMMIT_PATTERN.test(input.commit)) invalidManifest();

    const manifest = {
        schemaVersion: 2,
        releaseId: `${input.generation}-${input.attempt}-${input.commit}`,
        generation: input.generation,
        commit: input.commit,
        images: {
            server: input.serverImage,
            database: input.databaseImage,
        },
        dataBundle: {
            profiles: CANONICAL_PROFILES.map(profile => ({
                studyKey: profile.studyKey,
                expectedCardCount: profile.expectedCardCount,
                csv: {...profile.csv},
                manifest: {...profile.manifest},
            })),
        },
        schemaCompatibility: {
            produces: "study-schema-3",
            applicationSupports: ["study-schema-3"],
        },
        dataCompatibility: {
            produces: "copilot369-v1",
            applicationSupports: ["copilot369-v1"],
        },
        workflow: input.workflow,
        createdAt: input.createdAt,
    };
    return validateReleaseManifest(manifest);
};

export {ReleaseManifestError};
