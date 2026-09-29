import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readdirSync} from "node:fs";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const workflowsDirectory = path.join(root, ".github/workflows");

const dedicatedChangeNotice =
    "a dedicated approved change is required (workflow + fingerprints + contract tests updated in the same change)";

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

const expectedWorkflowNames = [
    "eslint.yml",
    "hadolint.yml",
    "markdownlint.yml",
    "pr-validation.yml",
    "release.yml",
    "shared-validation.yml",
    "stylelint.yml",
];

const hashOf = bytes => createHash("sha256").update(bytes).digest("hex");

test("Given the frozen master pipeline When listing .github/workflows Then the workflow set is exactly the canonical seven", () => {
    const actualNames = readdirSync(workflowsDirectory).sort();
    const expectedNames = [...expectedWorkflowNames].sort();
    assert.deepEqual(
        actualNames,
        expectedNames,
        `.github/workflows drifted from the frozen set: expected [${expectedNames.join(", ")}], got [${actualNames.join(", ")}]; ${dedicatedChangeNotice}`,
    );
});

test("Given the frozen master pipeline When hashing each frozen file Then every SHA-256 matches the b409233 baseline", async () => {
    for (const [relativePath, expectedFingerprint] of Object.entries(frozenFingerprints)) {
        const bytes = await readFile(path.join(root, relativePath));
        const actualFingerprint = hashOf(bytes);
        assert.equal(
            actualFingerprint,
            expectedFingerprint,
            `${relativePath} drifted from the b409233 baseline: expected ${expectedFingerprint}, got ${actualFingerprint}; ${dedicatedChangeNotice}`,
        );
    }
});
