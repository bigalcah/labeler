import assert from "node:assert/strict";
import test from "node:test";
import {loadParticipantCategories, loadStudyCard} from "../util/study-runtime.js";

test("category reads use the session study and participant while returning definition and color", async () => {
    const categoriesByMembership = new Map([
        ["study-1:11", [{id: "study-1-category", raw_name: "Study one", definition: "First", color_slot: 0}]],
        ["study-2:11", [{id: "study-2-category", raw_name: "Study two", definition: null, color_slot: 5}]],
        ["study-1:22", [{id: "study-1-peer-category", raw_name: "Peer", definition: "Peer definition", color_slot: 7}]],
    ]);
    let categoryQuery = null;
    const executor = {
        query: async (sql, parameters) => {
            categoryQuery = sql;
            return {rows: categoriesByMembership.get(`${parameters[0]}:${parameters[1]}`) || []};
        },
    };

    assert.deepEqual(
        await loadParticipantCategories(executor, "study-1", 11),
        [{id: "study-1-category", raw_name: "Study one", definition: "First", color_slot: 0}],
    );
    assert.deepEqual(
        await loadParticipantCategories(executor, "study-2", 11),
        [{id: "study-2-category", raw_name: "Study two", definition: null, color_slot: 5}],
    );
    assert.deepEqual(
        await loadParticipantCategories(executor, "study-1", 22),
        [{id: "study-1-peer-category", raw_name: "Peer", definition: "Peer definition", color_slot: 7}],
        "a peer participant never receives another participant's private definition",
    );
    assert.match(categoryQuery, /study_id = \$1/);
    assert.match(categoryQuery, /participant_id = \$2/);
    assert.match(categoryQuery, /definition/);
    assert.match(categoryQuery, /color_slot/);
});

test("card rendering joins classification categories within the card study", async () => {
    const cardsByMembership = new Map([
        ["study-1:11:card-1", {status: "PENDING"}],
        ["study-2:11:card-1", {status: "CLASSIFIED", own_category: "Study two"}],
    ]);
    let cardQuery = null;
    const executor = {
        query: async (sql, parameters) => {
            cardQuery = sql;
            return {rows: [cardsByMembership.get(parameters.join(":"))]};
        },
    };

    assert.deepEqual(await loadStudyCard(executor, "study-1", 11, "card-1"), {status: "PENDING"});
    assert.deepEqual(
        await loadStudyCard(executor, "study-2", 11, "card-1"),
        {status: "CLASSIFIED", own_category: "Study two"},
    );

    assert.match(cardQuery, /category\.study_id = study_card\.study_id/);
    assert.match(cardQuery, /category\.participant_id = \$2/);
});
