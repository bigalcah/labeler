import {readFile, stat} from "node:fs/promises";
import path from "node:path";

const REQUIRED_DOCUMENTS = Object.freeze([
    "README.md",
    "docs/ARCHITECTURE.md",
    "docs/DEVELOPMENT.md",
    "docs/OPERATIONS.md",
    "docs/STUDY-WORKFLOW.md",
    "deployment/GITHUB-ENRICHMENT.md",
    "deployment/ROLLBACK.md",
]);
const REQUIRED_LINKS = Object.freeze([
    Object.freeze({from: "README.md", to: "docs/STUDY-WORKFLOW.md"}),
    Object.freeze({from: "README.md", to: "docs/ARCHITECTURE.md"}),
    Object.freeze({from: "README.md", to: "docs/DEVELOPMENT.md"}),
    Object.freeze({from: "README.md", to: "docs/OPERATIONS.md"}),
    Object.freeze({from: "docs/STUDY-WORKFLOW.md", to: "deployment/GITHUB-ENRICHMENT.md"}),
    Object.freeze({from: "docs/STUDY-WORKFLOW.md", to: "deployment/ROLLBACK.md"}),
    Object.freeze({from: "docs/OPERATIONS.md", to: "deployment/GITHUB-ENRICHMENT.md"}),
    Object.freeze({from: "docs/OPERATIONS.md", to: "deployment/ROLLBACK.md"}),
]);
const REQUIRED_COMMANDS = Object.freeze([
    "validate:study-profiles",
    "prepare:study-profiles",
    "export:study",
    "docs:study-check",
]);
const EXPECTED_PROFILES = Object.freeze([
    Object.freeze({
        studyKey: "pr-card-sorting-local",
        expectedCardCount: 300,
        participants: Object.freeze([ "javier", "diego", "pablo" ]),
        loginUsernames: Object.freeze({javier: "javier", diego: "diego", pablo: "pablo"}),
    }),
    Object.freeze({
        studyKey: "pr-card-sorting-validation-30",
        expectedCardCount: 30,
        participants: Object.freeze([ "javier", "diego", "pablo" ]),
        loginUsernames: Object.freeze({javier: "javier-30", diego: "diego-30", pablo: "pablo-30"}),
    }),
]);
const MARKER_PATTERN = /<!--\s*study-documentation-contract\s*:\s*([\s\S]*?)\s*-->/gu;

const diagnostic = (code, details = {}) => ({code, ...details});
const sameList = (actual, expected) => Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
const exactKeys = (value, keys) => value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && sameList(Object.keys(value).sort(), [...keys].sort());
const sameRecord = (actual, expected) => exactKeys(actual, Object.keys(expected))
    && Object.entries(expected).every(([key, value]) => actual[key] === value);
const profileMatches = (actual, expected) => exactKeys(actual, Object.keys(expected))
    && actual.studyKey === expected.studyKey
    && actual.expectedCardCount === expected.expectedCardCount
    && sameList(actual.participants, expected.participants)
    && sameRecord(actual.loginUsernames, expected.loginUsernames);

const parseRoot = argumentsList => argumentsList.length === 0 ? "."
    : argumentsList.length === 2 && argumentsList[0] === "--root" && argumentsList[1]
        ? argumentsList[1]
        : null;

const readText = async (root, relativePath) => {
    try {
        return await readFile(path.join(root, relativePath), "utf8");
    } catch (_error) {
        return null;
    }
};

const hasRequiredLink = (content, from, target) => {
    const targets = [...content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/gu)]
        .map(match => match[1].split("#", 1)[0]);
    return targets.some(link => path.normalize(path.join(path.dirname(from), link)) === target);
};

const readContract = content => {
    const markers = [...content.matchAll(MARKER_PATTERN)];
    if (markers.length !== 1) return null;
    try {
        return JSON.parse(markers[0][1]);
    } catch (_error) {
        return null;
    }
};

const validateContract = contract => {
    const diagnostics = [];
    const expectedKeys = [
        "schemaVersion", "supportedCardCounts", "profiles", "preparationOrder", "studyIdAuthority",
        "participantSelector", "studySelector", "enrichment", "export", "adminUi", "evidence", "commands",
    ];
    if (!exactKeys(contract, expectedKeys)) diagnostics.push(diagnostic("CONTRACT_SHAPE_INVALID"));
    if (!sameList(contract?.supportedCardCounts, [ 30, 300 ])) {
        diagnostics.push(diagnostic("CONTRACT_SUPPORTED_COUNTS_INVALID"));
    }
    if (!Array.isArray(contract?.profiles) || contract.profiles.length !== EXPECTED_PROFILES.length
        || !contract.profiles.every((profile, index) => profileMatches(profile, EXPECTED_PROFILES[index]))) {
        diagnostics.push(diagnostic("CONTRACT_PROFILES_INVALID"));
    }
    if (!sameList(contract?.preparationOrder, EXPECTED_PROFILES.map(profile => profile.studyKey))) {
        diagnostics.push(diagnostic("CONTRACT_PREPARATION_ORDER_INVALID"));
    }
    if (contract?.studyIdAuthority !== "account-session") diagnostics.push(diagnostic("CONTRACT_STUDY_ID_AUTHORITY_INVALID"));
    if (contract?.participantSelector !== "unavailable") diagnostics.push(diagnostic("CONTRACT_PARTICIPANT_SELECTOR_INVALID"));
    if (contract?.studySelector !== "unavailable") diagnostics.push(diagnostic("CONTRACT_STUDY_SELECTOR_INVALID"));
    if (!sameRecord(contract?.enrichment, {mode: "optional-prepare-only", liveCapture: "pending"})) {
        if (contract?.enrichment?.mode !== "optional-prepare-only") diagnostics.push(diagnostic("CONTRACT_ENRICHMENT_MODE_INVALID"));
        if (contract?.enrichment?.liveCapture !== "pending") diagnostics.push(diagnostic("CONTRACT_LIVE_CAPTURE_STATUS_INVALID"));
    }
    if (!sameRecord(contract?.export, {access: "offline-operator-only", http: "unavailable", path: "/export"})) {
        if (contract?.export?.access !== "offline-operator-only") diagnostics.push(diagnostic("CONTRACT_EXPORT_ACCESS_INVALID"));
        if (contract?.export?.http !== "unavailable") diagnostics.push(diagnostic("CONTRACT_EXPORT_HTTP_INVALID"));
        if (contract?.export?.path !== "/export") diagnostics.push(diagnostic("CONTRACT_EXPORT_PATH_INVALID"));
    }
    if (contract?.adminUi !== "unavailable") diagnostics.push(diagnostic("CONTRACT_ADMIN_UI_INVALID"));
    const evidence = contract?.evidence;
    const expectedEvidence = {
        backupRestore: "pending",
        historicalE2E: "pending",
        vpsPublicE2E: "pending",
        documentationClosure: "pending",
    };
    const evidenceCodes = {
        backupRestore: "CONTRACT_BACKUP_RESTORE_STATUS_INVALID",
        historicalE2E: "CONTRACT_HISTORICAL_E2E_STATUS_INVALID",
        vpsPublicE2E: "CONTRACT_VPS_PUBLIC_E2E_STATUS_INVALID",
        documentationClosure: "CONTRACT_DOCUMENTATION_CLOSURE_STATUS_INVALID",
    };
    if (!sameRecord(evidence, expectedEvidence)) {
        for (const [key, value] of Object.entries(expectedEvidence)) {
            if (evidence?.[key] !== value) diagnostics.push(diagnostic(evidenceCodes[key]));
        }
    }
    if (!sameList(contract?.commands, REQUIRED_COMMANDS)) diagnostics.push(diagnostic("CONTRACT_COMMANDS_INVALID"));
    return diagnostics;
};

const validateProfileSource = async root => {
    const source = await readText(root, "util/study-profiles-input.js");
    if (source === null) return [diagnostic("PROFILE_SOURCE_MISSING", {path: "util/study-profiles-input.js"})];
    const counts = [...source.matchAll(/expectedCardCount\s*:\s*(\d+)/gu)]
        .map(match => Number(match[1]))
        .sort((left, right) => left - right);
    return sameList(counts, [ 30, 300 ]) ? [] : [diagnostic("PROFILE_SOURCE_COUNTS_INVALID", {path: "util/study-profiles-input.js"})];
};

const validateCommands = async root => {
    const packageText = await readText(root, "package.json");
    if (packageText === null) return [diagnostic("PACKAGE_MISSING", {path: "package.json"})];
    let packageJson;
    try {
        packageJson = JSON.parse(packageText);
    } catch (_error) {
        return [diagnostic("PACKAGE_INVALID", {path: "package.json"})];
    }
    const diagnostics = [];
    for (const command of REQUIRED_COMMANDS) {
        const script = packageJson?.scripts?.[command];
        const scriptMatch = typeof script === "string" && /^node\s+(scripts\/[A-Za-z0-9._/-]+\.js)$/u.exec(script);
        if (!scriptMatch || await readText(root, scriptMatch[1]) === null) {
            diagnostics.push(diagnostic("COMMAND_UNRESOLVED", {command}));
        }
    }
    return diagnostics;
};

const checkDocumentation = async root => {
    const diagnostics = [];
    const documents = new Map();
    for (const documentPath of REQUIRED_DOCUMENTS) {
        const content = await readText(root, documentPath);
        if (content === null) diagnostics.push(diagnostic("REQUIRED_DOCUMENTATION_MISSING", {path: documentPath}));
        else documents.set(documentPath, content);
    }
    for (const {from, to} of REQUIRED_LINKS) {
        const content = documents.get(from);
        if (content && !hasRequiredLink(content, from, to)) diagnostics.push(diagnostic("REQUIRED_LINK_MISSING", {from, to}));
    }
    const contract = documents.has("docs/STUDY-WORKFLOW.md") ? readContract(documents.get("docs/STUDY-WORKFLOW.md")) : null;
    if (contract === null) diagnostics.push(diagnostic("DOCUMENTATION_CONTRACT_MARKER_INVALID", {path: "docs/STUDY-WORKFLOW.md"}));
    else diagnostics.push(...validateContract(contract));
    diagnostics.push(...await validateProfileSource(root));
    diagnostics.push(...await validateCommands(root));
    return diagnostics;
};

const main = async () => {
    const rootInput = parseRoot(process.argv.slice(2));
    if (rootInput === null) return [diagnostic("ARGUMENTS_INVALID")];
    const root = path.resolve(rootInput);
    try {
        if (!(await stat(root)).isDirectory()) return [diagnostic("ROOT_INVALID")];
    } catch (_error) {
        return [diagnostic("ROOT_INVALID")];
    }
    return checkDocumentation(root);
};

const diagnostics = await main();
process.stdout.write(`${JSON.stringify(diagnostics.length === 0 ? {ok: true} : {ok: false, diagnostics})}\n`);
process.exitCode = diagnostics.length === 0 ? 0 : 1;
