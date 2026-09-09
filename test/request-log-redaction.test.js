import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("request log redaction preserves routing data without credential values", async () => {
    const {redactRequestLog} = await import("../util/log-redaction.js");
    const sessionMarker = "session-secret-sentinel";
    const passwordMarker = "password-secret-sentinel";
    const csrfMarker = "csrf-secret-sentinel";
    const tokenMarker = "token-secret-sentinel";
    const rawRequestLog = [
        `POST /login?next=%2Fqueue&csrf=${csrfMarker}&token=${tokenMarker} HTTP/1.1`,
        `Cookie: __Host-session=${sessionMarker}`,
        `Authorization: Bearer ${tokenMarker}`,
        `X-CSRF-Token: ${csrfMarker}`,
        `password=${passwordMarker}`,
    ].join(" ");

    const redacted = redactRequestLog(rawRequestLog);

    for (const marker of [sessionMarker, passwordMarker, csrfMarker, tokenMarker]) {
        assert.equal(redacted.includes(marker), false);
    }
    assert.equal(redacted.includes("POST /login"), true);
    assert.equal(redacted.includes("next=%2Fqueue"), true);
});

test("process request logging delegates every Morgan format to the redactor", async () => {
    const index = await readFile(new URL("../index.js", import.meta.url), "utf8");

    assert.match(index, /import\s+\{\s*redactRequestLog\s*\}\s+from "\.\/util\/log-redaction\.js";/);
    assert.match(index, /redactRequestLog\(/);
    assert.doesNotMatch(index, /morgan\(\s*["'][^"']+["']/);
});
