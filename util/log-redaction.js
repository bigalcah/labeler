const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEY = "[A-Za-z0-9_-]*(?:cookie|password|csrf(?:[-_]?token)?|token|authorization|secret)[A-Za-z0-9_-]*";

const redactRequestLog = value => {
    let text;
    try {
        text = value == null ? "" : String(value);
    } catch (_error) {
        return "";
    }

    return text
        .replace(new RegExp("(\\b(?:[A-Za-z0-9-]*cookie|[A-Za-z0-9-]*authorization)\\b\\s*:\\s*)[^\\r\\n]*", "gi"), `$1${REDACTED_VALUE}`)
        .replace(new RegExp(`(\\b${SENSITIVE_KEY}\\b\\s*:\\s*)(?:"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'|[^\\s,;]+)`, "gi"), `$1${REDACTED_VALUE}`)
        .replace(new RegExp(`(\\b${SENSITIVE_KEY}\\b\\s*=\\s*)(?:"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'|[^\\s,;&}\\]]+)`, "gi"), `$1${REDACTED_VALUE}`)
        .replace(new RegExp(`([?&;]\\s*${SENSITIVE_KEY}\\s*=\\s*)[^&#\\s]*`, "gi"), `$1${REDACTED_VALUE}`);
};

export {redactRequestLog};
