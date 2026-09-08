import assert from "node:assert/strict";
import test from "node:test";

const required = variable => {
    const value = process.env[variable];
    if (!value) throw new Error(`${variable} is required for the current-runtime integration contract`);
    return value;
};

const baseUrl = required("STUDY_HTTP_BASE_URL");
const participant = process.env.STUDY_HTTP_PARTICIPANT || "javier";
const replayCardId = required("STUDY_HTTP_REPLAY_CARD_ID");
const navigationCardId = required("STUDY_HTTP_NAVIGATION_CARD_ID");
const concurrentCardId = required("STUDY_HTTP_CONCURRENT_CARD_ID");
const categoryId = required("STUDY_HTTP_CATEGORY_ID");
const otherParticipant = process.env.STUDY_HTTP_OTHER_PARTICIPANT || "other-participant";
const request = (path, options) => fetch(`${baseUrl}${path}`, options);

test("HTTP contract returns 400 for malformed card and missing revision", async () => {
    const response = await request(`/${participant}/queue/not-a-uuid/discard`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
});

test("HTTP contract returns 404 for an unknown participant", async () => {
    const response = await request("/unknown-participant/queue");
    assert.equal(response.status, 404);
});

test("HTTP discard contract exposes 422, 303, and 409 replay outcomes", async () => {
    const invalid = await request(`/${participant}/queue/${replayCardId}/discard`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reason: {invalid: true}, expected_revision: 0}),
    });
    assert.equal(invalid.status, 422);

    const first = await request(`/${participant}/queue/${replayCardId}/discard`, {
        method: "POST",
        redirect: "manual",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reason: "  duplicate reason  ", expected_revision: 0}),
    });
    assert.equal(first.status, 303);

    const replay = await request(`/${participant}/queue/${replayCardId}/discard`, {
        method: "POST",
        redirect: "manual",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reason: "duplicate reason", expected_revision: 0}),
    });
    assert.equal(replay.status, 303);

    const conflict = await request(`/${participant}/queue/${replayCardId}/discard`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reason: "different reason", expected_revision: 0}),
    });
    assert.equal(conflict.status, 409);
});

test("HTTP navigation contract returns 303 after a valid mutation and never exposes another participant", async () => {
    const response = await request(`/${participant}/queue/${navigationCardId}/discard`, {
        method: "POST",
        redirect: "manual",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reason: "navigation", expected_revision: 0, category_id: categoryId}),
    });
    assert.equal(response.status, 303);
    assert.match(response.headers.get("location") || "", new RegExp(`/${participant}/queue`));
    assert.doesNotMatch(await response.text(), /other-participant|other-category|other-reason/);
});

test("HTTP discard contract lets the first concurrent mutation win", async () => {
    const makeRequest = () => request(`/${participant}/queue/${concurrentCardId}/discard`, {
        method: "POST",
        redirect: "manual",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reason: "concurrent-a", expected_revision: 0}),
    });
    const responses = await Promise.all([
        makeRequest(),
        request(`/${participant}/queue/${concurrentCardId}/discard`, {
            method: "POST",
            redirect: "manual",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({reason: "concurrent-b", expected_revision: 0}),
        }),
    ]);
    assert.deepEqual(responses.map(response => response.status).sort((left, right) => left - right), [ 303, 409 ]);
});

test("HTTP card responses do not expose another participant's private state", async () => {
    const response = await request(`/${participant}/queue/${replayCardId}`);
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), new RegExp(otherParticipant));
});
