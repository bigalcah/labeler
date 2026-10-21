import assert from "node:assert/strict";
import test from "node:test";
import {categoryName} from "./support/private-category-name.js";

const usernames = ["javier", "diego", "pablo", "javier-30", "diego-30", "pablo-30"];

test("all six private category markers are unique and cannot prefix-collide", () => {
    const markers = usernames.map(categoryName);

    assert.equal(new Set(markers).size, 6, "every login username must have a distinct full category marker");
    for (const [index, marker] of markers.entries()) {
        for (const [otherIndex, otherMarker] of markers.entries()) {
            if (index === otherIndex) continue;
            assert.equal(marker.includes(otherMarker), false, `${marker} must not contain the full marker ${otherMarker}`);
        }
    }
});
