import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {CATEGORY_PALETTE, CATEGORY_PALETTE_SIZE, categoryColor} from "../util/category-palette.js";

const cssPath = new URL("../public/css/main.css", import.meta.url);

const relativeLuminance = hex => {
    const channels = [ 1, 3, 5 ].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
        .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrastAgainst = (foreground, background = "#FFFFFF") => {
    const luminances = [ relativeLuminance(foreground), relativeLuminance(background) ]
        .sort((left, right) => right - left);
    return (luminances[0] + 0.05) / (luminances[1] + 0.05);
};

test("the category palette exposes exactly twelve slots with range validation", () => {
    assert.equal(CATEGORY_PALETTE_SIZE, 12);
    assert.equal(CATEGORY_PALETTE.length, CATEGORY_PALETTE_SIZE);
    assert.equal(new Set(CATEGORY_PALETTE.map(color => color.toUpperCase())).size, CATEGORY_PALETTE_SIZE, "slots must be distinct colors");
    CATEGORY_PALETTE.forEach((color, slot) => assert.equal(categoryColor(slot), color));
    for (const invalid of [ -1, 12, 1.5, "0", null, undefined, NaN ]) {
        assert.throws(() => categoryColor(invalid), RangeError, `slot ${String(invalid)} must be rejected`);
    }
});

test("every category color keeps at least 3:1 non-text contrast against a white surface", () => {
    for (const [slot, color] of CATEGORY_PALETTE.entries()) {
        const ratio = contrastAgainst(color);
        assert.ok(ratio >= 3, `slot ${slot} (${color}) renders at ${ratio.toFixed(2)}:1, below the 3:1 non-text floor`);
    }
});

test("the twelve CSS category-slot classes match util/category-palette.js by position", async () => {
    const css = await readFile(cssPath, "utf8");
    const declarations = new Map();
    for (const match of css.matchAll(/\.category-slot-(\d+)\s*\{\s*--category-color:\s*(#[0-9A-Fa-f]{6})\s*;\s*\}/g)) {
        declarations.set(Number(match[1]), match[2].toUpperCase());
    }
    assert.equal(declarations.size, CATEGORY_PALETTE_SIZE, "every palette slot must have a CSS custom-property class");
    for (let slot = 0; slot < CATEGORY_PALETTE_SIZE; slot += 1) {
        assert.equal(
            declarations.get(slot),
            CATEGORY_PALETTE[slot].toUpperCase(),
            `CSS class .category-slot-${slot} must match palette position ${slot}`,
        );
    }
    assert.doesNotMatch(css, /\.category-slot-12\s*\{/, "no class may exceed the twelve-slot contract");
});
