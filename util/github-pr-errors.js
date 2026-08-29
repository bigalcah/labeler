class GithubRequestError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "GithubRequestError";
        this.code = code;
        this.status = details.status ?? null;
        this.endpoint = details.endpoint ?? null;
        this.retryable = details.retryable === true;
    }
}

export {GithubRequestError};
