import assert from "node:assert/strict";
import test from "node:test";
import {
    assertNormalStudyConfig,
    DEFAULT_STUDY_CONFIG,
    readStudyConfig,
    StudyConfigError,
} from "../util/study-config.js";
import {readStudyBootstrapInput} from "../util/study-bootstrap-input.js";

const approvedConfigs = [
    {
        studyKey: "pr-card-sorting-local",
        expectedCardCount: 369,
        participants: ["javier", "diego", "pablo"],
        loginUsernames: {javier: "javier", diego: "diego", pablo: "pablo"},
    },
    {
        studyKey: "pr-card-sorting-validation-30",
        expectedCardCount: 30,
        participants: ["javier", "diego", "pablo"],
        loginUsernames: {javier: "javier-30", diego: "diego-30", pablo: "pablo-30"},
    },
];

test("Given no study configuration When the default is read Then the primary profile is the approved 369-card study", async () => {
    assert.deepEqual(await readStudyConfig(undefined), DEFAULT_STUDY_CONFIG);
    assert.equal(DEFAULT_STUDY_CONFIG.studyKey, "pr-card-sorting-local");
    assert.equal(DEFAULT_STUDY_CONFIG.expectedCardCount, 369);
});

test("Given the approved profile configs When normal configs are parsed Then both profile identities and login mappings are retained", async () => {
    for (const profile of approvedConfigs) {
        const config = assertNormalStudyConfig(await readStudyConfig(JSON.stringify(profile)));
        assert.deepEqual(config, profile);
    }
});

test("Given an unsupported or drifted config When normal bootstrap input is resolved Then it rejects before opening credentials or CSV", async () => {
    const invalidConfigs = [
        {...approvedConfigs[0], expectedCardCount: 300},
        {...approvedConfigs[0], studyKey: "pr-card-sorting-validation-30"},
        {...approvedConfigs[1], expectedCardCount: 369},
        {...approvedConfigs[0], participants: ["javier", "diego", "other"]},
        {...approvedConfigs[1], loginUsernames: {javier: "javier", diego: "diego", pablo: "pablo"}},
        {...approvedConfigs[0], source: "unapproved"},
    ];

    for (const config of invalidConfigs) {
        await assert.rejects(
            () => readStudyBootstrapInput({
                csvPath: "/source-is-not-opened.csv",
                configInput: JSON.stringify(config),
                manifestFile: "/credential-is-not-opened.json",
            }),
            error => error instanceof StudyConfigError,
        );
    }
});
