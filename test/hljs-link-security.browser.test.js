import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {access, copyFile, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {promisify} from "node:util";

const executeFile = promisify(execFile);
const chromeCandidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
].filter(Boolean);

test("browser renders GitHub-controlled highlighter URL and text without executing markup", async () => {
    // Given
    let chrome = null;
    for (const candidate of chromeCandidates) {
        try {
            await access(candidate);
            chrome = candidate;
            break;
        } catch (_error) {
            continue;
        }
    }
    if (!chrome) throw new Error("A Chrome or Chromium executable is required; set CHROME_BIN to run the browser regression");
    const directory = await mkdtemp(join(tmpdir(), "labeler-hljs-browser-"));
    const attackerUrl = "https://github.com/acme/repository/pull/7\"><img src=x onerror=window.compromised=true>";
    const attackerContent = `"${attackerUrl}"`;
    const encodedContent = Buffer.from(attackerContent).toString("base64");
    const fixture = `<!doctype html>
<html><body><span class="hljs-string" id="github-content"></span>
<script>
window.compromised = false;
document.querySelector("#github-content").textContent = atob("${encodedContent}");
window.hljs = {configure() {}, highlightElement() {}, lineNumbersBlock() {}};
</script>
<script src="hljs.js"></script>
<script>
document.addEventListener("DOMContentLoaded", () => setTimeout(() => {
    const link = document.querySelector("#github-content > a");
    const result = document.createElement("output");
    result.id = "security-result";
    result.dataset.compromised = String(window.compromised);
    result.dataset.imageCount = String(document.images.length);
    result.dataset.linkCount = String(document.querySelectorAll("#github-content > a").length);
    result.dataset.textMatches = String(link?.textContent === atob("${encodedContent}"));
    result.dataset.hrefMatches = String(link?.getAttribute("href") === atob("${encodedContent}").slice(1, -1));
    document.body.append(result);
}, 50));
</script></body></html>`;

    try {
        await Promise.all([
            copyFile(new URL("../public/js/hljs.js", import.meta.url), join(directory, "hljs.js")),
            writeFile(join(directory, "fixture.html"), fixture),
        ]);

        // When
        const {stdout} = await executeFile(chrome, [
            "--headless=new",
            "--disable-background-networking",
            "--disable-default-apps",
            "--disable-extensions",
            "--no-first-run",
            `--user-data-dir=${join(directory, "profile")}`,
            "--virtual-time-budget=500",
            "--dump-dom",
            `file://${join(directory, "fixture.html")}`,
        ], {maxBuffer: 1024 * 1024});

        // Then
        assert.match(stdout, /id="security-result"/);
        assert.match(stdout, /data-compromised="false"/);
        assert.match(stdout, /data-image-count="0"/);
        assert.match(stdout, /data-link-count="1"/);
        assert.match(stdout, /data-text-matches="true"/);
        assert.match(stdout, /data-href-matches="true"/);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});
