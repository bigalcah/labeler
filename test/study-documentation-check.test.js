import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const checkerPath = fileURLToPath(new URL("../scripts/check-study-documentation.js", import.meta.url));
const participantKeys = Object.freeze([ "javier", "diego", "pablo" ]);

const validContract = Object.freeze({
    schemaVersion: 1,
    supportedCardCounts: [ 30, 300 ],
    profiles: [
        {
            studyKey: "pr-card-sorting-local",
            expectedCardCount: 300,
            participants: participantKeys,
            loginUsernames: {javier: "javier", diego: "diego", pablo: "pablo"},
        },
        {
            studyKey: "pr-card-sorting-validation-30",
            expectedCardCount: 30,
            participants: participantKeys,
            loginUsernames: {javier: "javier-30", diego: "diego-30", pablo: "pablo-30"},
        },
    ],
    preparationOrder: [ "pr-card-sorting-local", "pr-card-sorting-validation-30" ],
    studyIdAuthority: "account-session",
    participantSelector: "unavailable",
    studySelector: "unavailable",
    enrichment: {mode: "optional-prepare-only", liveCapture: "pending"},
    export: {access: "offline-operator-only", http: "unavailable", path: "/export"},
    adminUi: "unavailable",
    evidence: {
        backupRestore: "pending",
        historicalE2E: "pending",
        vpsPublicE2E: "pending",
        documentationClosure: "pending",
    },
    commands: [ "validate:study-profiles", "prepare:study-profiles", "export:study", "docs:study-check" ],
});

const files = contract => ({
    "README.md": [
        "# Labeler",
        "[Study workflow](docs/STUDY-WORKFLOW.md)",
        "[Architecture](docs/ARCHITECTURE.md)",
        "[Development](docs/DEVELOPMENT.md)",
        "[Operations](docs/OPERATIONS.md)",
        "",
    ].join("\n"),
    "docs/ARCHITECTURE.md": "# Architecture\n",
    "docs/DEVELOPMENT.md": "# Development\n",
    "docs/OPERATIONS.md": [
        "# Operations",
        "[Enrichment](../deployment/GITHUB-ENRICHMENT.md)",
        "[Rollback](../deployment/ROLLBACK.md)",
        "",
    ].join("\n"),
    "docs/STUDY-WORKFLOW.md": `# Study workflow\n\n<!-- study-documentation-contract: ${JSON.stringify(contract)} -->\n\n[Enrichment](../deployment/GITHUB-ENRICHMENT.md)\n[Rollback](../deployment/ROLLBACK.md)\n`,
    "deployment/GITHUB-ENRICHMENT.md": "# Enrichment\n",
    "deployment/ROLLBACK.md": "# Rollback\n",
    "util/study-profiles-input.js": [
        "const profiles = [",
        "    {expectedCardCount: 300},",
        "    {expectedCardCount: 30},",
        "];",
        "",
    ].join("\n"),
    "scripts/validate-study-profiles.js": "",
    "scripts/prepare-study-profiles.js": "",
    "scripts/export-study.js": "",
    "scripts/check-study-documentation.js": "",
});

const packageJson = {
    type: "module",
    scripts: {
        "validate:study-profiles": "node scripts/validate-study-profiles.js",
        "prepare:study-profiles": "node scripts/prepare-study-profiles.js",
        "export:study": "node scripts/export-study.js",
        "docs:study-check": "node scripts/check-study-documentation.js",
    },
};

const withFixture = async (contract, operation, changes = {}) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "labeler-study-docs-"));
    try {
        const fixtureFiles = {...files(contract), ...changes.files};
        await Promise.all(Object.entries(fixtureFiles).map(async ([relativePath, contents]) => {
            const destination = path.join(root, relativePath);
            await mkdir(path.dirname(destination), {recursive: true});
            await writeFile(destination, contents, "utf8");
        }));
        await writeFile(path.join(root, "package.json"), JSON.stringify(changes.packageJson ?? packageJson), "utf8");
        return await operation(root);
    } finally {
        await rm(root, {recursive: true, force: true});
    }
};

const runChecker = root => new Promise((resolve, reject) => {
    execFile(process.execPath, [ checkerPath, "--root", root ], {encoding: "utf8"}, (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
            reject(error);
            return;
        }
        resolve({exitCode: error?.code ?? 0, stdout, stderr});
    });
});

test("Given a complete marker when the checker runs then it reports the valid documentation contract", async () => {
    await withFixture(validContract, async root => {
        const result = await runChecker(root);

        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.deepEqual(JSON.parse(result.stdout), {ok: true});
    });
});

test("Given contradictory structured claims when the checker runs then it emits actionable sanitized diagnostics", async () => {
    const cases = [
        ["participant selector", contract => { contract.participantSelector = "available"; }, "CONTRACT_PARTICIPANT_SELECTOR_INVALID"],
        ["study selector", contract => { contract.studySelector = "available"; }, "CONTRACT_STUDY_SELECTOR_INVALID"],
        ["arbitrary count", contract => { contract.supportedCardCounts = [ 30, 40, 300 ]; }, "CONTRACT_SUPPORTED_COUNTS_INVALID"],
        ["HTTP export", contract => { contract.export.http = "available"; }, "CONTRACT_EXPORT_HTTP_INVALID"],
        ["admin UI", contract => { contract.adminUi = "available"; }, "CONTRACT_ADMIN_UI_INVALID"],
        ["backup restore", contract => { contract.evidence.backupRestore = "completed"; }, "CONTRACT_BACKUP_RESTORE_STATUS_INVALID"],
        ["historical E2E", contract => { contract.evidence.historicalE2E = "completed"; }, "CONTRACT_HISTORICAL_E2E_STATUS_INVALID"],
        ["VPS public E2E", contract => { contract.evidence.vpsPublicE2E = "completed"; }, "CONTRACT_VPS_PUBLIC_E2E_STATUS_INVALID"],
        ["documentation closure", contract => { contract.evidence.documentationClosure = "completed"; }, "CONTRACT_DOCUMENTATION_CLOSURE_STATUS_INVALID"],
        ["live capture", contract => { contract.enrichment.liveCapture = "completed"; }, "CONTRACT_LIVE_CAPTURE_STATUS_INVALID"],
        ["sanitized value", contract => { contract.adminUi = "do-not-print-this-value"; }, "CONTRACT_ADMIN_UI_INVALID"],
    ];

    for (const [name, mutate, expectedCode] of cases) {
        const contract = structuredClone(validContract);
        mutate(contract);
        await withFixture(contract, async root => {
            const result = await runChecker(root);
            const output = JSON.parse(result.stdout);

            assert.equal(result.exitCode, 1, name);
            assert.equal(output.ok, false, name);
            assert.ok(output.diagnostics.some(diagnostic => diagnostic.code === expectedCode), name);
            assert.equal(result.stdout.includes("do-not-print-this-value"), false, name);
        });
    }
});

test("Given missing documentation links, commands, or profile counts when the checker runs then it rejects the selected root", async () => {
    await withFixture(validContract, async root => {
        await writeFile(path.join(root, "README.md"), "# Labeler\n", "utf8");
        await writeFile(path.join(root, "util/study-profiles-input.js"), "const profiles = [{expectedCardCount: 300}];\n", "utf8");
        await writeFile(path.join(root, "package.json"), JSON.stringify({type: "module", scripts: {}}), "utf8");

        const result = await runChecker(root);
        const codes = new Set(JSON.parse(result.stdout).diagnostics.map(diagnostic => diagnostic.code));

        assert.equal(result.exitCode, 1);
        assert.ok(codes.has("REQUIRED_LINK_MISSING"));
        assert.ok(codes.has("COMMAND_UNRESOLVED"));
        assert.ok(codes.has("PROFILE_SOURCE_COUNTS_INVALID"));
    });
});
