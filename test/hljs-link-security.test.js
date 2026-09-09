import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {runInNewContext} from "node:vm";

const highlighterScript = await readFile(new URL("../public/js/hljs.js", import.meta.url), "utf8");

test("client highlighter rejects interpolation of GitHub-controlled strings into innerHTML", () => {
    assert.doesNotMatch(
        highlighterScript,
        /\.innerHTML\s*=\s*`[^`]*(?:\$\{url\}|\$\{content\})[^`]*`/,
        "GitHub-controlled URL and text must not be interpolated into innerHTML",
    );
});

test("client highlighter renders a GitHub-controlled URL as an inert text-node link", () => {
    const attackerControlledUrl = "https://github.com/acme/repository/pull/7\"><img src=x onerror=globalThis.compromised=true>";
    const attackerControlledContent = `"${attackerControlledUrl}"`;
    const stringElement = {
        assignedHtml: "",
        children: [],
        executableMarkupCreated: false,
        textContent: attackerControlledContent,
        replaceChildren(...children) {
            this.children = children;
        },
    };
    Object.defineProperty(stringElement, "innerHTML", {
        set(value) {
            this.assignedHtml = value;
            this.executableMarkupCreated = /<[^>]+(?:on[a-z]+\s*=|<script\b)/i.test(value);
        },
    });

    const domContentLoadedListeners = [];
    const document = {
        addEventListener(eventName, listener) {
            assert.equal(eventName, "DOMContentLoaded");
            domContentLoadedListeners.push(listener);
        },
        createElement(tagName) {
            return {href: "", tagName: tagName.toUpperCase(), target: "", textContent: ""};
        },
        querySelectorAll(selector) {
            if (selector === "pre code" || selector === "code.hljs") return [];
            if (selector === "span.hljs-string") return [stringElement];
            throw new Error(`Unexpected selector: ${selector}`);
        },
    };
    const window = {
        hljs: {
            configure: () => {},
            highlightElement: () => {},
            lineNumbersBlock: () => {},
        },
    };

    runInNewContext(highlighterScript, {document, window});
    assert.equal(domContentLoadedListeners.length, 1);
    domContentLoadedListeners[0]();

    assert.equal(stringElement.executableMarkupCreated, false);
    assert.equal(stringElement.children.length, 1);
    const [link] = stringElement.children;
    assert.equal(link.tagName, "A");
    assert.equal(link.href, attackerControlledUrl);
    assert.equal(link.target, "_blank");
    assert.equal(link.textContent, attackerControlledContent);
});
