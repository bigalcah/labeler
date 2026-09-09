const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' https://cdn.jsdelivr.net data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "script-src-attr 'none'",
    "style-src 'self' https://cdn.jsdelivr.net",
    "style-src-attr 'none'",
].join("; ");

const createSecurityHeadersMiddleware = ({nodeEnv = process.env.NODE_ENV || "development"} = {}) => (req, res, next) => {
    res.set({
        "Cache-Control": "no-store",
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
    });
    if (nodeEnv === "production" && req.secure) {
        res.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }
    next();
};

export {CONTENT_SECURITY_POLICY, createSecurityHeadersMiddleware};
