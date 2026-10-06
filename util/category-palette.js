const CATEGORY_PALETTE_SIZE = 12;
const CATEGORY_PALETTE = Object.freeze([
    "#4E79A7",
    "#C05F17",
    "#E15759",
    "#337E76",
    "#59A14F",
    "#A97C00",
    "#B07AA1",
    "#9C755F",
    "#8A827E",
    "#2F4B7C",
    "#D37295",
    "#499894",
]);

const categoryColor = slot => {
    if (!Number.isInteger(slot) || slot < 0 || slot >= CATEGORY_PALETTE_SIZE) {
        throw new RangeError(`Category color slot must be an integer between 0 and ${CATEGORY_PALETTE_SIZE - 1}`);
    }
    return CATEGORY_PALETTE[slot];
};

export {CATEGORY_PALETTE, CATEGORY_PALETTE_SIZE, categoryColor};
