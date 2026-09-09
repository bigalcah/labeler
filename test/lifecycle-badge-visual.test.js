import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import ejs from "ejs";
import {projectCardV2} from "../util/study-card-projection.js";

const root = new URL("..", import.meta.url);
const lifecycleStates = Object.freeze([
    {label: "OPEN", className: "pr-status-open", state: "open", merged: false},
    {label: "CLOSED", className: "pr-status-closed", state: "closed", merged: false},
    {label: "MERGED", className: "pr-status-merged", state: "closed", merged: true},
    {label: "UNAVAILABLE", className: "pr-status-unknown", state: null, merged: false},
]);

const card = lifecycle => ({
    id: `card-${lifecycle.label.toLowerCase()}`,
    source_card_id: `card-${lifecycle.label.toLowerCase()}`,
    repository: "owner/repository",
    pr_number: 7,
    title: `${lifecycle.label} lifecycle card`,
    body: null,
    author: "author",
    language: "JavaScript",
    state: lifecycle.state,
    merged: lifecycle.merged,
    html_url: null,
    created_at_source: null,
    closed_at_source: null,
    merged_at_source: null,
    summary: {},
    evidence: {},
});

const colorValue = (css, className, property) => {
    const declaration = css.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`))?.[1];
    return declaration?.match(new RegExp(`${property}:\\s*(#[0-9a-f]{3,6})`, "i"))?.[1];
};

const relativeLuminance = hex => {
    const channels = hex.slice(1).length === 3
        ? hex.slice(1).split("").map(value => Number.parseInt(`${value}${value}`, 16))
        : hex.slice(1).match(/../g).map(value => Number.parseInt(value, 16));
    const linear = channels.map(value => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrastRatio = (foreground, background) => {
    const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((left, right) => right - left);
    return (lighter + 0.05) / (darker + 0.05);
};

test("lifecycle badges render visible text semantics and AA contrast for every state", async () => {
    const [template, css] = await Promise.all([
        readFile(new URL("views/partials/instance/data.ejs", root), "utf8"),
        readFile(new URL("public/css/main.css", root), "utf8"),
    ]);

    const renderedBadges = lifecycleStates.map(lifecycle => {
        const sourceCard = card(lifecycle);
        const rendered = ejs.render(template, {
            data: {...sourceCard, card_v2: projectCardV2(sourceCard)},
            renderSafeMarkdown: value => String(value),
        });
        return {lifecycle, rendered};
    });

    for (const {lifecycle, rendered} of renderedBadges) {
        assert.match(
            rendered,
            new RegExp(`<span class="pr-status badge rounded-pill ${lifecycle.className}">${lifecycle.label}</span>`),
        );
        const foreground = colorValue(css, lifecycle.className, "color");
        const background = colorValue(css, lifecycle.className, "background");
        assert.ok(foreground, `${lifecycle.label} needs an explicit foreground color`);
        assert.ok(background, `${lifecycle.label} needs an explicit background color`);
        assert.ok(
            contrastRatio(foreground, background) >= 4.5,
            `${lifecycle.label} text must meet the WCAG AA 4.5:1 contrast threshold`,
        );
    }

    assert.deepEqual(renderedBadges.map(({lifecycle}) => lifecycle.label), ["OPEN", "CLOSED", "MERGED", "UNAVAILABLE"]);
});
