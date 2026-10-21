const commit = "0123456789abcdef0123456789abcdef01234567";
const serverImage = `ghcr.io/example/labeler-server:sha-${commit}@sha256:${"a".repeat(64)}`;
const databaseImage = `ghcr.io/example/labeler-database:sha-${commit}@sha256:${"b".repeat(64)}`;

export const createCanonicalManifestFixture = () => ({
    schemaVersion: 2,
    releaseId: `42-3-${commit}`,
    generation: 42,
    commit,
    images: {server: serverImage, database: databaseImage},
    dataBundle: {
        profiles: [
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
        ],
    },
    schemaCompatibility: {
        produces: "study-schema-3",
        applicationSupports: ["study-schema-3"],
    },
    dataCompatibility: {
        produces: "copilot369-v1",
        applicationSupports: ["copilot369-v1"],
    },
    workflow: "release/456/3",
    createdAt: "2026-09-11T12:34:56Z",
});

const invalidManifestMutators = [
    ["missing root field", manifest => { delete manifest.workflow; }],
    ["unknown root field", manifest => { manifest.csv = {}; }],
    ["unknown version", manifest => { manifest.schemaVersion = 3; }],
    ["string schema version", manifest => { manifest.schemaVersion = "2"; }],
    ["string generation", manifest => { manifest.generation = "42"; }],
    ["negative generation", manifest => { manifest.generation = -1; }],
    ["fractional generation", manifest => { manifest.generation = 1.5; }],
    ["generation above bound", manifest => { manifest.generation = 2_147_483_648; }],
    ["release id with leading zero", manifest => { manifest.releaseId = `042-3-${commit}`; }],
    ["release id generation mismatch", manifest => { manifest.releaseId = `43-3-${commit}`; }],
    ["release id attempt zero", manifest => { manifest.releaseId = `42-0-${commit}`; }],
    ["release id extra segment", manifest => { manifest.releaseId = `42-3-extra-${commit}`; }],
    ["release id commit mismatch", manifest => { manifest.releaseId = `42-3-${"f".repeat(40)}`; }],
    ["uppercase commit", manifest => { manifest.commit = commit.toUpperCase(); }],
    ["server image commit mismatch", manifest => {
        manifest.images.server = manifest.images.server.replace(commit, "f".repeat(40));
    }],
    ["database image incomplete digest", manifest => {
        manifest.images.database = manifest.images.database.slice(0, -1);
    }],
    ["missing image", manifest => { delete manifest.images.database; }],
    ["extra image", manifest => { manifest.images.cache = serverImage; }],
    ["extra data bundle field", manifest => { manifest.dataBundle.csv = {}; }],
    ["extra profile", manifest => { manifest.dataBundle.profiles.push(manifest.dataBundle.profiles[0]); }],
    ["duplicate profile", manifest => { manifest.dataBundle.profiles[1] = manifest.dataBundle.profiles[0]; }],
    ["missing profile", manifest => { manifest.dataBundle.profiles.pop(); }],
    ["reordered profiles", manifest => { manifest.dataBundle.profiles.reverse(); }],
    ["wrong primary profile", manifest => { manifest.dataBundle.profiles[0].studyKey = "legacy-300"; }],
    ["wrong primary count", manifest => { manifest.dataBundle.profiles[0].expectedCardCount = 300; }],
    ["wrong primary CSV path", manifest => { manifest.dataBundle.profiles[0].csv.path = "/labeling/data/pr-cards.csv"; }],
    ["wrong primary sidecar path", manifest => {
        manifest.dataBundle.profiles[0].manifest.path = "/labeling/data/other.manifest.json";
    }],
    ["wrong validation profile", manifest => { manifest.dataBundle.profiles[1].studyKey = "pr-card-sorting-local"; }],
    ["wrong validation count", manifest => { manifest.dataBundle.profiles[1].expectedCardCount = 31; }],
    ["wrong validation CSV path", manifest => { manifest.dataBundle.profiles[1].csv.path = "/labeling/data/pr-cards.csv"; }],
    ["wrong validation sidecar path", manifest => {
        manifest.dataBundle.profiles[1].manifest.path = "/labeling/data/other.manifest.json";
    }],
    ["missing profile field", manifest => { delete manifest.dataBundle.profiles[0].csv; }],
    ["extra profile field", manifest => { manifest.dataBundle.profiles[0].commit = commit; }],
    ["invalid 369 CSV hash", manifest => { manifest.dataBundle.profiles[0].csv.sha256 = "0".repeat(64); }],
    ["missing 369 CSV hash", manifest => { delete manifest.dataBundle.profiles[0].csv.sha256; }],
    ["invalid 369 sidecar hash", manifest => { manifest.dataBundle.profiles[0].manifest.sha256 = "0".repeat(64); }],
    ["missing 369 sidecar hash", manifest => { delete manifest.dataBundle.profiles[0].manifest.sha256; }],
    ["invalid 30 CSV hash", manifest => { manifest.dataBundle.profiles[1].csv.sha256 = "0".repeat(64); }],
    ["missing 30 CSV hash", manifest => { delete manifest.dataBundle.profiles[1].csv.sha256; }],
    ["invalid 30 sidecar hash", manifest => { manifest.dataBundle.profiles[1].manifest.sha256 = "0".repeat(64); }],
    ["missing 30 sidecar hash", manifest => { delete manifest.dataBundle.profiles[1].manifest.sha256; }],
    ["wrong schema token", manifest => { manifest.schemaCompatibility.produces = "study-schema-2"; }],
    ["extra schema support", manifest => { manifest.schemaCompatibility.applicationSupports.push("study-schema-2"); }],
    ["duplicate schema support", manifest => { manifest.schemaCompatibility.applicationSupports.push("study-schema-3"); }],
    ["wrong data token", manifest => { manifest.dataCompatibility.produces = "legacy300-v1"; }],
    ["extra data support", manifest => { manifest.dataCompatibility.applicationSupports.push("legacy300-v1"); }],
    ["missing compatibility field", manifest => { delete manifest.dataCompatibility; }],
    ["missing schema support", manifest => { delete manifest.schemaCompatibility.applicationSupports; }],
    ["invalid workflow syntax", manifest => { manifest.workflow = "release/0456/3?"; }],
    ["secret-name workflow", manifest => { manifest.workflow = "release/secret-name/3"; }],
    ["password-name workflow", manifest => { manifest.workflow = "release/password/3"; }],
    ["token-name workflow", manifest => { manifest.workflow = "release/token/3"; }],
    ["credential-name workflow", manifest => { manifest.workflow = "release/credential/3"; }],
    ["private key-name workflow", manifest => { manifest.workflow = "release/private-key/3"; }],
    ["workflow with invalid characters", manifest => { manifest.workflow = "release/456/3?"; }],
    ["workflow exceeding historical length", manifest => { manifest.workflow = `a${"b".repeat(256)}`; }],
    ["impossible UTC date", manifest => { manifest.createdAt = "2026-02-30T12:34:56Z"; }],
    ["invalid UTC time", manifest => { manifest.createdAt = "2026-09-11T25:34:56Z"; }],
    ["non-UTC date", manifest => { manifest.createdAt = "2026-09-11T12:34:56+00:00"; }],
];

export const invalidManifestFixtures = () => invalidManifestMutators.map(([name, mutate]) => {
    const manifest = createCanonicalManifestFixture();
    mutate(manifest);
    return {name, manifest, expectedError: "INVALID_MANIFEST"};
});

export const invalidRawManifestFixtures = [
    {
        name: "duplicate root JSON key",
        raw: "{\"schemaVersion\":2,\"schemaVersion\":2}",
        expectedError: "DUPLICATE_JSON_KEY",
    },
    {
        name: "duplicate decoded JSON key",
        raw: "{\"releaseId\":\"a\",\"\\u0072eleaseId\":\"b\"}",
        expectedError: "DUPLICATE_JSON_KEY",
    },
    {
        name: "duplicate nested JSON key",
        raw: "{\"images\":{\"server\":\"a\",\"server\":\"b\"}}",
        expectedError: "DUPLICATE_JSON_KEY",
    },
    {
        name: "malformed JSON",
        raw: "{\"schemaVersion\":2,,}",
        expectedError: "INVALID_JSON",
    },
    {
        name: "v1 incoming manifest",
        raw: JSON.stringify({schemaVersion: 1, releaseId: "42-3-0123456789abcdef0123456789abcdef01234567"}),
        expectedError: "INVALID_MANIFEST",
    },
];

export const canonicalManifestInputFixture = () => ({
    generation: 42,
    attempt: 3,
    commit,
    serverImage,
    databaseImage,
    workflow: "release/456/3",
    createdAt: "2026-09-11T12:34:56Z",
});
