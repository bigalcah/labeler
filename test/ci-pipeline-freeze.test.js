import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readdirSync} from "node:fs";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const workflowsDirectory = path.join(root, ".github/workflows");
const fingerprintsPath = path.join(root, "deployment/ci-pipeline-fingerprints.json");

const dedicatedChangeNotice =
    "a dedicated approved change and owner review are required (exact paths and before/after fingerprints)";

const frozenFingerprints = {
    ".github/workflows/eslint.yml": "54308ecff8eaf4a8663288c10549ef7582d6aabea17c116b2c3874c225e3571b",
    ".github/workflows/hadolint.yml": "454b34470b1b2135c4fa52ec8d8d2188fb62eeb51da051deb2c3fd20976e290e",
    ".github/workflows/markdownlint.yml": "2b353de68107949afa1c236272ac35ebacc80cabe8819c533405d81c6dde38fd",
    ".github/workflows/pr-validation.yml": "95d16131b01cb2810d21cb05e32315f9cef3bb5863fdfd0d9d94d401cc76e57b",
    ".github/workflows/release.yml": "a5652aa72e65d49cafad76e807eddb1d801ee5ec6aad331e3e9b676e4dacb20b",
    ".github/workflows/shared-validation.yml": "18cbb8b5d4092cb16a7d962d269c23c9a2a03d1b974ee8e2dcaa86b1fc92035e",
    ".github/workflows/stylelint.yml": "9edc9ccf3fd2c248343a78efb1c33acb42e41f357a24e187b8d1c79e909c21cd",
    "deployment/docker-compose.release.yml": "e29073914a704bdaeef3845efadc1e8e1b802efba56b10f09e373daf19798a96",
};

const approvedExceptionPaths = [
    ".github/workflows/release.yml",
    ".github/workflows/shared-validation.yml",
    "deployment/docker-compose.release.yml",
];

const approvedExceptions = {
    ".github/workflows/release.yml": {
        before: frozenFingerprints[".github/workflows/release.yml"],
        after: "3f56829b4da5cd8dc923c973aa45886b05e6c57fd221c83400f93d6c8e41d9be",
    },
    ".github/workflows/shared-validation.yml": {
        before: frozenFingerprints[".github/workflows/shared-validation.yml"],
        after: "6088383a4a0e82730f02829dd4a57af5e76411d9a0ecdb64b0896bd8dd6f4e86",
    },
    "deployment/docker-compose.release.yml": {
        before: frozenFingerprints["deployment/docker-compose.release.yml"],
        after: "fb6316592ff713692b9dd9ad9fc79df396c9f68ff3d277de6269717dc05e715d",
    },
};

const expectedWorkflowNames = [
    "eslint.yml",
    "hadolint.yml",
    "markdownlint.yml",
    "pr-validation.yml",
    "release.yml",
    "shared-validation.yml",
    "stylelint.yml",
];

const codeownersFingerprint = "9c527527fdbb6da9f60bd6aaa6ca8cc7f2542f6c4604f3339ab92f60a1c40787";

const hashOf = bytes => createHash("sha256").update(bytes).digest("hex");

const readFreezePolicy = async () => JSON.parse(await readFile(fingerprintsPath, "utf8"));

const assertFreezePolicy = policy => {
    assert.deepEqual(
        Object.keys(policy).sort(),
        ["approvedExceptions", "baselineCommit", "baselineFingerprints", "codeowners", "workflowNames"].sort(),
        "freeze policy must have exactly the reviewed root keys",
    );
    assert.equal(policy.baselineCommit, "b409233", "freeze policy baseline must remain b409233");
    assert.deepEqual(policy.workflowNames, expectedWorkflowNames, "freeze policy must name exactly the canonical workflows");
    assert.deepEqual(policy.baselineFingerprints, frozenFingerprints, "historical baseline fingerprints must stay pinned");
    assert.deepEqual(
        Object.keys(policy.approvedExceptions).sort(),
        [...approvedExceptionPaths].sort(),
        "the exception allowlist must contain exactly the three approved paths",
    );
    assert.deepEqual(policy.approvedExceptions, approvedExceptions, "each exception must retain its pinned before/after hashes");
    assert.deepEqual(
        policy.codeowners,
        {path: ".github/CODEOWNERS", sha256: codeownersFingerprint},
        "CODEOWNERS must remain at its pinned current fingerprint",
    );
};

test("Given the frozen master pipeline When listing .github/workflows Then the workflow set is exactly the canonical seven", () => {
    const actualNames = readdirSync(workflowsDirectory).sort();
    assert.deepEqual(
        actualNames,
        expectedWorkflowNames,
        `.github/workflows drifted from the frozen set: expected [${expectedWorkflowNames.join(", ")}], got [${actualNames.join(", ")}]; ${dedicatedChangeNotice}`,
    );
});

test("Given the approved freeze exception When reading its policy Then exact baseline, allowlist, and before/after fingerprints are pinned", async () => {
    assertFreezePolicy(await readFreezePolicy());
});

test("Given an incorrect exception hash When validating the policy Then the contract rejects the mutation", async () => {
    const mutatedPolicy = structuredClone(await readFreezePolicy());
    mutatedPolicy.approvedExceptions[".github/workflows/release.yml"].after = "0".repeat(64);

    assert.throws(() => assertFreezePolicy(mutatedPolicy));
});

test("Given an added exception path When validating the policy Then the contract rejects the mutation", async () => {
    const mutatedPolicy = structuredClone(await readFreezePolicy());
    mutatedPolicy.approvedExceptions["deployment/deploy-vps.sh"] = {
        before: "0".repeat(64),
        after: "1".repeat(64),
    };

    assert.throws(() => assertFreezePolicy(mutatedPolicy));
});

test("Given the current frozen set When hashing its files Then only the three approved paths match their new fingerprints", async () => {
    const expectedCurrentFingerprints = {...frozenFingerprints};
    for (const [relativePath, fingerprints] of Object.entries(approvedExceptions)) {
        expectedCurrentFingerprints[relativePath] = fingerprints.after;
    }

    for (const [relativePath, expectedFingerprint] of Object.entries(expectedCurrentFingerprints)) {
        const bytes = await readFile(path.join(root, relativePath));
        const actualFingerprint = hashOf(bytes);
        assert.equal(
            actualFingerprint,
            expectedFingerprint,
            `${relativePath} drifted from its frozen fingerprint: expected ${expectedFingerprint}, got ${actualFingerprint}; ${dedicatedChangeNotice}`,
        );
    }
});

test("Given CODEOWNERS When checking the preserved ownership boundary Then its current fingerprint matches the pinned value", async () => {
    const bytes = await readFile(path.join(root, ".github/CODEOWNERS"));
    assert.equal(hashOf(bytes), codeownersFingerprint, ".github/CODEOWNERS changed; the freeze exception does not authorize it");
});
