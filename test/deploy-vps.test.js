import assert from "node:assert/strict";
import test from "node:test";
import {hostContracts} from "./host-runner.js";

const proves = async name => assert.match(await hostContracts(), new RegExp(`${name} \\(.*\\) \\.{3} ok`));

test("forced SSH streams a generated release package and verifies images and all four artifacts before backup and preparation", async () => {
    await proves("test_complete_ingress_orders_images_backup_pending_prepare_runtime_smoke_publication");
});

test("archive ingress rejects traversal, links, duplicate, and undeclared entries before Docker", async () => {
    await proves("test_archive_inventory_is_exact_when_hostile_members_arrive");
    await proves("test_hostile_ingress_never_reaches_docker_or_active_state");
});

test("forced SSH accepts only the exact allowlisted command shape", async () => {
    await proves("test_forced_ssh_rejects_nonallowlisted_commands_and_extra_spacing");
});

test("digest or any embedded artifact mismatch fails before backup and preserves adopted state", async () => {
    await proves("test_image_and_config_rejections_leave_no_installed_candidate_floor_or_changed_journal");
});

test("rendered Compose with a different project identity fails before backup and preparation", async () => {
    await proves("test_wrong_project_or_external_profile_mount_fails_without_state_changes");
});

test("Compose warnings do not contaminate rendered JSON evidence", async () => {
    await proves("test_compose_warning_does_not_corrupt_configuration_when_rendered");
});

test("production configuration with an inline database secret fails under lock before Docker or backup", async () => {
    await proves("test_inline_configuration_secret_fails_before_docker_or_backup");
});

test("preflight, backup, or preparation failure never publishes candidate state or starts candidate runtime", async () => {
    await proves("test_failed_backup_or_marker_never_starts_database_or_installs_candidate");
    await proves("test_prepare_failure_blocks_runtime_and_requires_reconcile_not_generic_retry");
});

test("runtime failure restores only a both-axes-compatible active application before returning failure", async () => {
    await proves("test_runtime_failure_attempts_only_compatible_v2_restore_and_remains_failed");
    await proves("test_late_first_v2_failure_never_activates_historical_v1");
});

test("an identical retry requires readonly reconciliation and explicit fresh continuation", async () => {
    await proves("test_reconcile_target_prevents_repeating_prepare_when_destination_is_exact");
    await proves("test_retry_retained_caddyfile_is_readable_without_repeating_prepare");
});

test("the host lock serializes streamed releases and rejects a stale generation", async () => {
    await proves("test_common_flock_serializes_competitors_and_older_loser_never_installs");
    await proves("test_stale_generation_replay_never_changes_completed_publication");
});

test("rollback requires both compatibility axes and never invokes dependencies or database rollback", async () => {
    await proves("test_rollback_checks_both_axes_and_preserves_floor_without_database_commands");
    await proves("test_failed_rollback_never_reports_success_or_reduces_floor");
});
