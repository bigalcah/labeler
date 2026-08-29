import {checksum} from "./github-pr-manifest.js";

const DEFAULT_GITHUB_CONFIG = Object.freeze({
    enabled: false,
    apiBase: "https://api.github.com",
    apiVersion: "2022-11-28",
    accept: "application/vnd.github+json",
    userAgent: "labeler-github-enrichment/1.0",
    concurrency: 4,
    timeoutMs: 30_000,
    maxAttempts: 4,
    pageWaitBudgetMs: 5 * 60 * 1000,
    runWaitBudgetMs: 30 * 60 * 1000,
    aliases: Object.freeze({}),
    defaultAlias: "default",
});

class GithubConfigError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "GithubConfigError";
        this.code = code;
    }
}

const normalizeRepository = repository => {
    if (typeof repository !== "string") throw new GithubConfigError("INVALID_REPOSITORY", "Repository must be owner/name");
    const normalized = repository.trim().toLowerCase();
    if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) {
        throw new GithubConfigError("INVALID_REPOSITORY", "Repository must be owner/name");
    }
    return normalized;
};

const assertInteger = (name, value, minimum, maximum) => {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new GithubConfigError("INVALID_POLICY", `${name} is outside its allowed range`);
    }
};

const normalizeAlias = (aliasName, alias) => {
    if (!alias || typeof alias !== "object" || Array.isArray(alias)) throw new GithubConfigError("INVALID_PROFILE", `Profile ${aliasName} is invalid`);
    const tokenEnv = typeof alias.tokenEnv === "string" && alias.tokenEnv.trim().length > 0 ? alias.tokenEnv.trim() : null;
    const tokenFile = typeof alias.tokenFile === "string" && alias.tokenFile.trim().length > 0 ? alias.tokenFile.trim() : null;
    if ((tokenEnv && tokenFile) || (!tokenEnv && !tokenFile)) throw new GithubConfigError("INVALID_PROFILE", `Profile ${aliasName} must have exactly one secret source`);
    const permissions = new Set(Array.isArray(alias.permissions) ? alias.permissions : []);
    for (const permission of ["metadata", "pulls", "contents", "issues"]) {
        if (!permissions.has(permission)) throw new GithubConfigError("INSUFFICIENT_PERMISSIONS", `Alias ${aliasName} lacks required access`);
    }
    return Object.freeze({
        tokenEnv,
        tokenFile,
        permissions,
    });
};

const validateGithubConfig = input => {
    const source = {enabled: false, ...(input || {})};
    if (typeof source.enabled !== "boolean") throw new GithubConfigError("INVALID_ENABLEMENT", "GitHub enablement must be boolean");
    if (!source.enabled) return Object.freeze({...DEFAULT_GITHUB_CONFIG, enabled: false, aliases: Object.freeze({}), defaultAlias: "default"});
    const aliases = source.aliases;
    if (!aliases || typeof aliases !== "object" || Array.isArray(aliases) || Object.keys(aliases).length !== 1 || !Object.hasOwn(aliases, "default")) {
        throw new GithubConfigError("INVALID_PROFILE", "Exactly one neutral default profile is required");
    }
    const defaultAlias = source.defaultAlias === undefined ? DEFAULT_GITHUB_CONFIG.defaultAlias : source.defaultAlias;
    if (defaultAlias !== "default") throw new GithubConfigError("INVALID_PROFILE", "The default profile must be named default");
    const normalizedAliases = {default: normalizeAlias("default", aliases.default)};
    const config = {
        ...DEFAULT_GITHUB_CONFIG,
        ...source,
        aliases: Object.freeze(normalizedAliases),
        defaultAlias,
    };
    assertInteger("concurrency", config.concurrency, 1, 8);
    assertInteger("timeoutMs", config.timeoutMs, 1, Number.MAX_SAFE_INTEGER);
    assertInteger("maxAttempts", config.maxAttempts, 1, 4);
    assertInteger("pageWaitBudgetMs", config.pageWaitBudgetMs, 0, Number.MAX_SAFE_INTEGER);
    assertInteger("runWaitBudgetMs", config.runWaitBudgetMs, 0, Number.MAX_SAFE_INTEGER);
    if (typeof config.apiBase !== "string" || !/^https:\/\//.test(config.apiBase)) {
        throw new GithubConfigError("INVALID_API_BASE", "GitHub API base must use HTTPS");
    }
    if (typeof config.apiVersion !== "string" || config.apiVersion.length === 0) {
        throw new GithubConfigError("INVALID_API_VERSION", "GitHub API version is required");
    }
    return Object.freeze(config);
};

const readGithubConfig = (environment = process.env) => {
    const enabled = environment.GITHUB_ENRICHMENT_ENABLED === "true";
    if (!enabled) return validateGithubConfig({enabled: false});
    let aliases = {};
    if (environment.GITHUB_CREDENTIAL_ALIASES) {
        try {
            aliases = JSON.parse(environment.GITHUB_CREDENTIAL_ALIASES);
        } catch (_error) {
            throw new GithubConfigError("INVALID_PROFILE", "Credential profile configuration is not valid JSON");
        }
    }
    return validateGithubConfig({
        enabled,
        apiBase: environment.GITHUB_API_BASE || DEFAULT_GITHUB_CONFIG.apiBase,
        apiVersion: environment.GITHUB_API_VERSION || DEFAULT_GITHUB_CONFIG.apiVersion,
        accept: environment.GITHUB_ACCEPT || DEFAULT_GITHUB_CONFIG.accept,
        userAgent: environment.GITHUB_USER_AGENT || DEFAULT_GITHUB_CONFIG.userAgent,
        concurrency: environment.GITHUB_CONCURRENCY ? Number(environment.GITHUB_CONCURRENCY) : DEFAULT_GITHUB_CONFIG.concurrency,
        timeoutMs: environment.GITHUB_TIMEOUT_MS ? Number(environment.GITHUB_TIMEOUT_MS) : DEFAULT_GITHUB_CONFIG.timeoutMs,
        maxAttempts: environment.GITHUB_MAX_ATTEMPTS ? Number(environment.GITHUB_MAX_ATTEMPTS) : DEFAULT_GITHUB_CONFIG.maxAttempts,
        pageWaitBudgetMs: environment.GITHUB_PAGE_WAIT_BUDGET_MS ? Number(environment.GITHUB_PAGE_WAIT_BUDGET_MS) : DEFAULT_GITHUB_CONFIG.pageWaitBudgetMs,
        runWaitBudgetMs: environment.GITHUB_RUN_WAIT_BUDGET_MS ? Number(environment.GITHUB_RUN_WAIT_BUDGET_MS) : DEFAULT_GITHUB_CONFIG.runWaitBudgetMs,
        aliases,
        defaultAlias: environment.GITHUB_DEFAULT_ALIAS || "default",
    });
};

const resolveCredential = (config, repository, environment = process.env, readSecretFile = null) => {
    if (!config.enabled) throw new GithubConfigError("DISABLED", "GitHub enrichment is disabled");
    normalizeRepository(repository);
    const aliasName = "default";
    const alias = config.aliases[aliasName];
    if (!alias) throw new GithubConfigError("INVALID_PROFILE", "The default profile is unavailable");
    let token;
    try {
        token = alias.tokenEnv ? environment[alias.tokenEnv] : readSecretFile?.(alias.tokenFile);
    } catch (_error) {
        throw new GithubConfigError("CREDENTIAL_NOT_FOUND", "Credential secret is unavailable");
    }
    if (typeof token !== "string" || token.trim().length === 0) throw new GithubConfigError("CREDENTIAL_NOT_FOUND", "Credential secret is unavailable");
    const cleanToken = token.trim();
    return {alias: aliasName, permissions: alias.permissions, getToken: () => cleanToken};
};

const githubConfigFingerprint = config => checksum({
    enabled: config.enabled,
    apiBase: config.apiBase,
    apiVersion: config.apiVersion,
    accept: config.accept,
    userAgent: config.userAgent,
    concurrency: config.concurrency,
    timeoutMs: config.timeoutMs,
    maxAttempts: config.maxAttempts,
    pageWaitBudgetMs: config.pageWaitBudgetMs,
    runWaitBudgetMs: config.runWaitBudgetMs,
    profile: {
        name: "default",
        tokenEnv: config.aliases.default?.tokenEnv || null,
        tokenFile: config.aliases.default?.tokenFile || null,
        permissions: [...(config.aliases.default?.permissions || [])].sort(),
    },
});

export {
    DEFAULT_GITHUB_CONFIG,
    GithubConfigError,
    githubConfigFingerprint,
    normalizeRepository,
    readGithubConfig,
    resolveCredential,
    validateGithubConfig,
};
