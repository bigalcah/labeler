import assert from "node:assert/strict";

const seedClosedStudyEnrichment = async (client, studyId) => {
    const {rows: [run]} = await client.query(
        `INSERT INTO github_enrichment_run(study_id,source_checksum,config_fingerprint,normalizer_version,state)
         SELECT id,source_checksum,'history-fixture','fixture-v1','RUNNING' FROM study WHERE id=$1 RETURNING id`,
        [studyId]);
    await client.query(
        `INSERT INTO github_card_snapshot(pr_card_id,snapshot_checksum,normalizer_version,manifest)
         SELECT pr_card_id,'closed-fixture-' || pr_card_id,'fixture-v1',jsonb_build_object('fixture',true)
         FROM study_card WHERE study_id=$1 ON CONFLICT DO NOTHING`, [studyId]);
    await client.query(
        `INSERT INTO github_enrichment_run_card(run_id,study_id,pr_card_id,snapshot_id,snapshot_checksum,ordinal)
         SELECT $2,member.study_id,member.pr_card_id,snapshot.id,snapshot.snapshot_checksum,member.ordinal
         FROM study_card member JOIN github_card_snapshot snapshot ON snapshot.pr_card_id=member.pr_card_id
           AND snapshot.snapshot_checksum='closed-fixture-' || member.pr_card_id
         WHERE member.study_id=$1`, [studyId, run.id]);
    await client.query(
        `INSERT INTO github_run_page(run_id,study_id,pr_card_id,endpoint,page_ordinal,request_fingerprint,
            api_version,accept,http_status,state,item_count,normalized_payload)
         SELECT $2,study_id,pr_card_id,'pulls',0,'fixture','2022-11-28','application/vnd.github+json',
            200,'COMPLETE',1,'[]' FROM study_card WHERE study_id=$1`, [studyId, run.id]);
    await client.query("UPDATE github_enrichment_run SET state='COMPLETED',manifest_checksum='fixture' WHERE id=$1", [run.id]);
    await client.query(
        `INSERT INTO study_enrichment_promotion(study_id,run_id,source_checksum)
         SELECT id,$2,source_checksum FROM study WHERE id=$1`, [studyId, run.id]);
    const {rows: [failed]} = await client.query(
        `INSERT INTO github_enrichment_run(study_id,source_checksum,config_fingerprint,normalizer_version,state,checkpoint)
         SELECT id,source_checksum,'history-fixture','fixture-v1','RUNNING','{"partial":true}'
         FROM study WHERE id=$1 RETURNING id`, [studyId]);
    await client.query(
        `INSERT INTO github_run_page(run_id,study_id,pr_card_id,endpoint,page_ordinal,request_fingerprint,
            api_version,accept,state,next_url,normalized_payload)
         SELECT $2,study_id,pr_card_id,'reviews',0,'partial-fixture','2022-11-28',
            'application/vnd.github+json','PARTIAL','https://api.github.com/fixture?page=2','[]'
         FROM study_card WHERE study_id=$1 AND ordinal=0`, [studyId, failed.id]);
    await client.query("UPDATE github_enrichment_run SET state='FAILED' WHERE id=$1", [failed.id]);
    await client.query(
        `INSERT INTO github_api_telemetry_event(event_id,event_type,run_id,study_id,occurred_at,checkpoint)
         VALUES(gen_random_uuid(),'PAUSE_COMMITTED',$2,$1,now(),'{"partial":true}')`, [studyId, failed.id]);
    assert.equal((await client.query(
        "SELECT count(*)::integer AS count FROM github_enrichment_run_card WHERE run_id=$1", [failed.id])).rows[0].count, 0);
    return {completedRunId: run.id, failedRunId: failed.id};
};

export {seedClosedStudyEnrichment};
