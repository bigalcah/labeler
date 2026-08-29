import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.STUDY_HTTP_BASE_URL;
const participant = process.env.STUDY_HTTP_PARTICIPANT || "javier";
const cardId = process.env.STUDY_HTTP_CARD_ID || "550e8400-e29b-41d4-a716-446655440000";
const categoryId = process.env.STUDY_HTTP_CATEGORY_ID || cardId;
const concurrentCardId = process.env.STUDY_HTTP_CONCURRENT_CARD_ID || cardId;
const otherParticipant = process.env.STUDY_HTTP_OTHER_PARTICIPANT || "other-participant";
const request = (path, options) => fetch(`${baseUrl}${path}`, options);
const unavailable = "requires STUDY_HTTP_BASE_URL against a prepared study database";

test("HTTP contract returns 400 for malformed card and missing revision", {skip: !baseUrl && unavailable}, async () => {
    const response = await request(`/${participant}/queue/not-a-uuid/discard`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
});

test("HTTP contract returns 404 for an unknown participant", {skip: !baseUrl && unavailable}, async () => {
    const response = await request("/unknown-participant/queue");
    assert.equal(response.status, 404);
});

test("HTTP contract returns 503 when no unique ready study exists", {
    skip: !baseUrl || process.env.STUDY_HTTP_EXPECT_AMBIGUOUS !== "1"
        ? unavailable
        : false,
}, async () => {
    const response = await request(`/${participant}/queue`);
    assert.equal(response.status, 503);
});

test("HTTP discard contract exposes 422, 303, and 409 replay outcomes", {skip: !baseUrl && unavailable}, async () => {
    const invalid = await request(`/${participant}/queue/${cardId}/discard`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reason: {invalid: true}, expected_revision: 0}),
    });
    assert.equal(invalid.status, 422);

    const first = await request(`/${participant}/queue/${cardId}/discard`, {
        method: "POST",
        redirect: "manual",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reason: "  duplicate reason  ", expected_revision: 0}),
    });
    assert.equal(first.status, 303);

    const replay = await request(`/${participant}/queue/${cardId}/discard`, {
        method: "POST",
        redirect: "manual",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reason: "duplicate reason", expected_revision: 0}),
    });
    assert.equal(replay.status, 303);

    const conflict = await request(`/${participant}/queue/${cardId}/discard`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reason: "different reason", expected_revision: 0}),
    });
    assert.equal(conflict.status, 409);
});

test("HTTP navigation contract returns 303 after a valid mutation and never exposes another participant", {skip: !baseUrl && unavailable}, async () => {
    const response = await request(`/${participant}/queue/${cardId}/discard`, {
        method: "POST",
        redirect: "manual",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reason: "navigation", expected_revision: 0, category_id: categoryId}),
    });
    assert.equal(response.status, 303);
    assert.match(response.headers.get("location") || "", new RegExp(`/${participant}/queue`));
    assert.doesNotMatch(await response.text(), /other-participant|other-category|other-reason/);
});

test("HTTP discard contract lets the first concurrent mutation win", {skip: !baseUrl && unavailable}, async () => {
    const makeRequest = () => request(`/${participant}/queue/${concurrentCardId}/discard`, {
        method: "POST",
        redirect: "manual",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reason: "concurrent", expected_revision: 0}),
    });
    const responses = await Promise.all([ makeRequest(), makeRequest() ]);
    assert.deepEqual(responses.map(response => response.status).sort((left, right) => left - right), [ 303, 409 ]);
});

test("HTTP card responses do not expose another participant's private state", {skip: !baseUrl && unavailable}, async () => {
    const response = await request(`/${participant}/queue/${cardId}`);
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), new RegExp(otherParticipant));
});
