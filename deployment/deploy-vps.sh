#!/usr/bin/env bash
# allow: SIZE_OK - this fail-closed deployment state machine is one restricted SSH entrypoint.

set -Eeuo pipefail
umask 077

readonly DEPLOY_ROOT="${LABELER_DEPLOY_ROOT:-}"
readonly ENV_FILE="${LABELER_ENV_FILE:-}"
readonly BACKUP_COMMAND="${LABELER_BACKUP_COMMAND:-}"
readonly PUBLIC_BASE_URL="${LABELER_PUBLIC_BASE_URL:-}"
readonly MANIFEST_NAME="release-manifest.json"
readonly COMPOSE_NAME="docker-compose.yml"
readonly PACKAGE_FILES=("$MANIFEST_NAME" "$COMPOSE_NAME" "Caddyfile")
readonly MAX_ARCHIVE_BYTES=10485760

ACTION=""
REQUESTED_RELEASE_ID=""
STAGE="initialization"
EVIDENCE_DIR=""
ARCHIVE_TMP=""
STAGING_DIR=""
RELEASE_ID=""
GENERATION=""
SERVER_IMAGE=""
DATABASE_IMAGE=""
CSV_PATH=""
CSV_SHA256=""
PRODUCED_SCHEMA=""
COMPOSE_ARGS=()

fail() {
    if [[ -n "$EVIDENCE_DIR" ]]; then
        printf '%s\n' "$1" >> "$EVIDENCE_DIR/diagnostic.log"
    fi
    printf 'DEPLOY_VPS_FAILED: %s\n' "$1" >&2
    return 1
}

on_exit() {
    local status=$?
    [[ -z "$ARCHIVE_TMP" ]] || rm -f -- "$ARCHIVE_TMP"
    [[ -z "$STAGING_DIR" ]] || rm -rf -- "$STAGING_DIR"
    if [[ -n "$EVIDENCE_DIR" && ! -e "$EVIDENCE_DIR/result" ]]; then
        if ((status == 0)); then
            printf 'SUCCEEDED %s\n' "$STAGE" > "$EVIDENCE_DIR/result"
        else
            printf 'FAILED %s\n' "$STAGE" > "$EVIDENCE_DIR/result"
        fi
    fi
}
trap on_exit EXIT

validate_release_id() {
    [[ "$1" =~ ^[0-9]+-[1-9][0-9]*-[a-f0-9]{40}$ ]] || fail "invalid release ID"
}

parse_request() {
    local original_command
    if [[ -v SSH_ORIGINAL_COMMAND ]]; then
        (($# == 0)) || fail "forced SSH invocation does not accept direct arguments"
        original_command=$SSH_ORIGINAL_COMMAND
        if [[ "$original_command" =~ ^deploy\ ([0-9]+-[1-9][0-9]*-[a-f0-9]{40})$ ]]; then
            ACTION="deploy"
            REQUESTED_RELEASE_ID=${BASH_REMATCH[1]}
        elif [[ "$original_command" == "rollback" ]]; then
            ACTION="rollback"
        else
            fail "SSH_ORIGINAL_COMMAND is not authorized"
        fi
    else
        if (($# == 2)) && [[ "$1" == "deploy" ]]; then
            ACTION="deploy"
            REQUESTED_RELEASE_ID=$2
        elif (($# == 1)) && [[ "$1" == "rollback" ]]; then
            ACTION="rollback"
        else
            fail "usage: deploy-vps.sh deploy <release-id> | rollback"
        fi
    fi
    [[ "$ACTION" != "deploy" ]] || validate_release_id "$REQUESTED_RELEASE_ID"
}

validate_deploy_root() {
    [[ "$DEPLOY_ROOT" == /* ]] || fail "deployment root must be absolute"
    [[ -d "$DEPLOY_ROOT" && ! -L "$DEPLOY_ROOT" ]] || fail "deployment root must be an existing host directory"
    for command in cmp curl docker flock grep head jq readlink stat tar; do
        command -v "$command" >/dev/null || fail "$command is required"
    done
    mkdir -p -- "$DEPLOY_ROOT/releases" "$DEPLOY_ROOT/evidence" "$DEPLOY_ROOT/state" "$DEPLOY_ROOT/locks" "$DEPLOY_ROOT/incoming"
    for state_directory in releases evidence state locks incoming; do
        [[ -d "$DEPLOY_ROOT/$state_directory" && ! -L "$DEPLOY_ROOT/$state_directory" ]] || fail "deployment state directories must not be symbolic links"
    done
}

validate_external_inputs() {
    [[ "$ENV_FILE" == /* && "$BACKUP_COMMAND" == /* ]] || fail "host paths must be absolute"
    [[ -f "$ENV_FILE" && -r "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail "production env file must be a readable regular file"
    [[ -f "$BACKUP_COMMAND" && -x "$BACKUP_COMMAND" && ! -L "$BACKUP_COMMAND" ]] || fail "backup command must be an executable regular file"
    [[ "$ENV_FILE" != "$DEPLOY_ROOT"/* && "$BACKUP_COMMAND" != "$DEPLOY_ROOT"/* ]] || fail "configuration and backup command must remain outside deployment state"
    [[ "$PUBLIC_BASE_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || fail "public base URL must be an HTTPS origin"
    [[ ! -v PGPASSWORD && ! -v STUDY_BACKUP_ENCRYPTION_PASSPHRASE ]] || fail "inline database or backup secrets are forbidden"
    ! grep -Eq '^[[:space:]]*(export[[:space:]]+)?(PGPASSWORD|STUDY_BACKUP_ENCRYPTION_PASSPHRASE)[[:space:]]*=' "$ENV_FILE" \
        || fail "production env file contains a forbidden inline secret"
}

start_evidence() {
    local evidence_id=$1
    EVIDENCE_DIR="$DEPLOY_ROOT/evidence/$evidence_id/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p -- "$EVIDENCE_DIR"
}

run_stage() {
    local name=$1
    shift
    STAGE=$name
    "$@" > "$EVIDENCE_DIR/$name.log" 2>&1
}

read_manifest() {
    local manifest_path=$1
    local manifest_values
    [[ -f "$manifest_path" && ! -L "$manifest_path" ]] || fail "release manifest is missing or unsafe"
    jq -e '. as $manifest |
        ($manifest | keys | sort) == ["commit", "createdAt", "csv", "generation", "images", "releaseId", "schemaCompatibility", "schemaVersion", "workflow"]
        and ($manifest.images | keys | sort) == ["database", "server"]
        and ($manifest.csv | keys | sort) == ["commit", "path", "sha256"]
        and ($manifest.schemaCompatibility | keys | sort) == ["applicationSupports", "produces"]
        and $manifest.schemaVersion == 1
        and ($manifest.releaseId | type == "string" and test("^[0-9]+-[1-9][0-9]*-[a-f0-9]{40}$"))
        and ($manifest.generation | type == "number" and floor == . and . >= 0 and . <= 2147483647)
        and ($manifest.commit | type == "string" and test("^[a-f0-9]{40}$"))
        and (($manifest.releaseId | capture("^(?<generation>[0-9]+)-(?<attempt>[1-9][0-9]*)-(?<commit>[a-f0-9]{40})$")) as $identity
            | ($identity.generation | tonumber) == $manifest.generation
            and ($identity.attempt | length <= 10 and tonumber <= 2147483647)
            and $identity.commit == $manifest.commit)
        and ($manifest.images.server | type == "string" and test("^[a-z0-9][a-z0-9._/-]*:sha-" + $manifest.commit + "@sha256:[a-f0-9]{64}$"))
        and ($manifest.images.database | type == "string" and test("^[a-z0-9][a-z0-9._/-]*:sha-" + $manifest.commit + "@sha256:[a-f0-9]{64}$"))
        and $manifest.csv.path == "/labeling/data/pr-cards.csv"
        and ($manifest.csv.sha256 | type == "string" and test("^[a-f0-9]{64}$"))
        and ($manifest.csv.commit == $manifest.commit)
        and ($manifest.schemaCompatibility.produces | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"))
        and ($manifest.schemaCompatibility.applicationSupports | type == "array" and length > 0
            and all(type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")))
        and ($manifest.schemaCompatibility.applicationSupports | length == (unique | length))
        and ($manifest.schemaCompatibility.applicationSupports | index($manifest.schemaCompatibility.produces) != null)
        and ($manifest.workflow | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$"))
        and ($manifest.createdAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
        and ([$manifest | paths(scalars) as $path | select(($path | map(tostring) | join("."))
            | test("(^|\\.)(password|secret|token|credential|private[_-]?key)($|\\.)"; "i"))] | length == 0)
    ' "$manifest_path" >/dev/null || fail "release manifest contract is invalid"
    manifest_values="$(jq -er '[.releaseId, (.generation | tostring), .images.server, .images.database,
        .csv.path, .csv.sha256, .schemaCompatibility.produces] | @tsv' "$manifest_path")"
    IFS=$'\t' read -r RELEASE_ID GENERATION SERVER_IMAGE DATABASE_IMAGE CSV_PATH CSV_SHA256 PRODUCED_SCHEMA <<< "$manifest_values"
}

active_generation() {
    local generation_file="$DEPLOY_ROOT/state/highest-generation"
    if [[ ! -e "$generation_file" ]]; then
        printf '%s' -1
        return
    fi
    [[ -f "$generation_file" && ! -L "$generation_file" ]] || fail "generation state is unsafe"
    local value
    value="$(<"$generation_file")"
    [[ "$value" =~ ^[0-9]+$ ]] || fail "generation state is invalid"
    printf '%s' "$value"
}

receive_release() {
    local archive_list="$EVIDENCE_DIR/archive-entries.log"
    local archive_metadata="$EVIDENCE_DIR/archive-metadata.log"
    local highest package_file entry
    local -a entries=()
    local -A counts=()
    STAGE="package-ingress"
    ARCHIVE_TMP="$DEPLOY_ROOT/incoming/.archive-$$"
    STAGING_DIR="$DEPLOY_ROOT/incoming/.release-$$"
    head -c "$((MAX_ARCHIVE_BYTES + 1))" > "$ARCHIVE_TMP"
    [[ -s "$ARCHIVE_TMP" ]] || fail "release archive is empty"
    (($(stat -c %s "$ARCHIVE_TMP") <= MAX_ARCHIVE_BYTES)) || fail "release archive exceeds the size limit"
    tar -tf "$ARCHIVE_TMP" > "$archive_list" || fail "release archive cannot be listed"
    mapfile -t entries < "$archive_list"
    ((${#entries[@]} == ${#PACKAGE_FILES[@]})) || fail "release archive entry count is invalid"
    for entry in "${entries[@]}"; do
        case "$entry" in
            "$MANIFEST_NAME"|"$COMPOSE_NAME"|Caddyfile) ((counts["$entry"]+=1)) ;;
            *) fail "release archive contains a non-allowlisted path" ;;
        esac
    done
    for package_file in "${PACKAGE_FILES[@]}"; do
        [[ "${counts[$package_file]:-0}" == 1 ]] || fail "release archive contains missing or duplicate entries"
    done
    tar -tvf "$ARCHIVE_TMP" > "$archive_metadata" || fail "release archive metadata cannot be read"
    while IFS= read -r entry; do
        [[ "${entry:0:1}" == "-" ]] || fail "release archive entries must be regular files"
    done < "$archive_metadata"
    mkdir -- "$STAGING_DIR"
    tar -xf "$ARCHIVE_TMP" --directory "$STAGING_DIR" --no-same-owner --no-same-permissions \
        > "$EVIDENCE_DIR/archive-extract.log" 2>&1 || fail "release archive extraction failed"
    for package_file in "${PACKAGE_FILES[@]}"; do
        [[ -f "$STAGING_DIR/$package_file" && ! -L "$STAGING_DIR/$package_file" ]] || fail "extracted release package is unsafe"
    done
    cp -- "$STAGING_DIR/$MANIFEST_NAME" "$EVIDENCE_DIR/$MANIFEST_NAME"
    read_manifest "$STAGING_DIR/$MANIFEST_NAME"
    [[ "$RELEASE_ID" == "$REQUESTED_RELEASE_ID" ]] || fail "release ID does not match manifest"
    highest="$(active_generation)"
    ((GENERATION > highest)) || fail "stale generation $GENERATION cannot replace $highest"
    if [[ -e "$DEPLOY_ROOT/releases/$RELEASE_ID" ]]; then
        [[ -d "$DEPLOY_ROOT/releases/$RELEASE_ID" && ! -L "$DEPLOY_ROOT/releases/$RELEASE_ID" ]] || fail "installed release path is unsafe"
        for package_file in "${PACKAGE_FILES[@]}"; do
            cmp -s -- "$STAGING_DIR/$package_file" "$DEPLOY_ROOT/releases/$RELEASE_ID/$package_file" \
                || fail "installed release differs from the streamed package"
        done
        rm -rf -- "$STAGING_DIR"
    else
        mv -- "$STAGING_DIR" "$DEPLOY_ROOT/releases/$RELEASE_ID"
    fi
    STAGING_DIR=""
}

configure_compose() {
    local release_dir=$1
    export LABELER_SERVER_IMAGE="$SERVER_IMAGE"
    export LABELER_DATABASE_IMAGE="$DATABASE_IMAGE"
    export LABELER_RELEASE_CSV_PATH="$CSV_PATH"
    export LABELER_RELEASE_CSV_SHA256="$CSV_SHA256"
    COMPOSE_ARGS=(compose --env-file "$ENV_FILE" -f "$release_dir/$COMPOSE_NAME")
}

expected_repo_digest() {
    local image_without_digest=${1%@*}
    printf '%s@%s' "${image_without_digest%:sha-*}" "${1##*@}"
}

verify_image_digest() {
    local evidence_name=$1
    local image=$2
    local expected
    expected="$(expected_repo_digest "$image")"
    run_stage "$evidence_name" docker image inspect --format '{{json .RepoDigests}}' "$image"
    jq -e --arg expected "$expected" 'index($expected) != null' "$EVIDENCE_DIR/$evidence_name.log" >/dev/null \
        || fail "image RepoDigests do not contain the declared digest"
}

preflight_compose() {
    local config_path="$EVIDENCE_DIR/compose-config.json"
    local public_hostname actual_csv reported_csv
    run_stage compose-config docker "${COMPOSE_ARGS[@]}" config --format json
    cp -- "$EVIDENCE_DIR/compose-config.log" "$config_path"
    jq -e --arg server "$SERVER_IMAGE" --arg database "$DATABASE_IMAGE" --arg deployRoot "$DEPLOY_ROOT" '
        .name == "labeling"
        and .services["labeling-database"].container_name == "labeling-database"
        and .services["labeling-database"].image == $database
        and .services["labeling-study-prepare"].image == $server
        and .services["labeling-server"].container_name == "labeling-server"
        and .services["labeling-server"].image == $server
        and .services["labeling-caddy"].container_name == "labeling-caddy"
        and (.services["labeling-caddy"].environment.PUBLIC_HOSTNAME | type == "string" and length > 0)
        and .volumes.data.name == "labeling-data"
        and .networks.default.name == "labeling-network"
        and ([.services["labeling-database"].volumes[]
            | select(.type == "volume" and .source == "data" and .target == "/var/lib/postgresql/data")]
            | length == 1)
        and ([.services[]?.volumes[]? | select(.type == "bind" and
            ((.target | startswith("/run/secrets/")) or (.target | startswith("/run/config/"))))
            | select(((.source | startswith("/")) | not) or (.source | startswith($deployRoot + "/")))] | length == 0)
    ' "$config_path" >/dev/null || fail "rendered Compose configuration does not match the release manifest"
    public_hostname="$(jq -er '.services["labeling-caddy"].environment.PUBLIC_HOSTNAME' "$config_path")"
    [[ "$PUBLIC_BASE_URL" == "https://$public_hostname" || "$PUBLIC_BASE_URL" == "https://$public_hostname:"* ]] || fail "public smoke origin does not match Compose"
    run_stage images-pull docker "${COMPOSE_ARGS[@]}" pull
    verify_image_digest server-image "$SERVER_IMAGE"
    verify_image_digest database-image "$DATABASE_IMAGE"
    run_stage image-csv docker run --rm --network none --read-only --cap-drop ALL --entrypoint sha256sum "$SERVER_IMAGE" "$CSV_PATH"
    read -r actual_csv reported_csv < "$EVIDENCE_DIR/image-csv.log"
    [[ "$actual_csv" == "$CSV_SHA256" && "$reported_csv" == "$CSV_PATH" ]] || fail "server image CSV checksum does not match the manifest"
}

atomic_write() {
    local destination=$1 value=$2 temporary="$1.tmp-$$"
    printf '%s\n' "$value" > "$temporary"
    mv -fT -- "$temporary" "$destination"
}

atomic_link() {
    local name=$1 target=$2 temporary="$DEPLOY_ROOT/$1.tmp-$$"
    ln -s -- "$target" "$temporary"
    mv -fT -- "$temporary" "$DEPLOY_ROOT/$name"
}

publish_deployment() {
    local old_current=""
    if [[ -L "$DEPLOY_ROOT/current" ]]; then
        old_current="$(readlink "$DEPLOY_ROOT/current")"
    elif [[ -e "$DEPLOY_ROOT/current" ]]; then
        fail "current state is not a symbolic link"
    fi
    [[ -z "$old_current" || "$old_current" =~ ^releases/[0-9]+-[1-9][0-9]*-[a-f0-9]{40}$ ]] || fail "current state target is invalid"
    if [[ -n "$old_current" ]]; then
        atomic_link previous "$old_current"
    fi
    atomic_link current "releases/$RELEASE_ID"
    atomic_write "$DEPLOY_ROOT/state/highest-generation" "$GENERATION"
    atomic_write "$DEPLOY_ROOT/state/active-schema-version" "$PRODUCED_SCHEMA"
    atomic_write "$DEPLOY_ROOT/state/deployment" "current=$RELEASE_ID previous=${old_current#releases/} generation=$GENERATION schema=$PRODUCED_SCHEMA"
}

schema_is_supported() {
    jq -e --arg schema "$2" '.schemaCompatibility.applicationSupports | index($schema) != null' "$1" >/dev/null
}

smoke_check() {
    local prefix=${1:-}
    run_stage "${prefix}health" docker "${COMPOSE_ARGS[@]}" ps
    run_stage "${prefix}smoke" curl --fail --silent --show-error --max-time 30 "$PUBLIC_BASE_URL/login"
}

verify_database_health() {
    run_stage database-health docker inspect --format '{{.State.Health.Status}}' labeling-database
    grep -Fxq healthy "$EVIDENCE_DIR/database-health.log" || fail "PostgreSQL is not healthy"
}

prepare_previous_application() {
    local manifest_path=$1 active_schema=$2
    read_manifest "$manifest_path"
    schema_is_supported "$manifest_path" "$active_schema" || fail "previous release has no declared schema compatibility"
    export LABELER_SERVER_IMAGE="$SERVER_IMAGE"
    run_stage rollback-pull docker pull "$SERVER_IMAGE"
    verify_image_digest rollback-image "$SERVER_IMAGE"
}

automatic_image_rollback() {
    local candidate_database=$DATABASE_IMAGE candidate_schema=$PRODUCED_SCHEMA
    local active_target active_dir
    STAGE="automatic-image-rollback"
    [[ -L "$DEPLOY_ROOT/current" ]] || return 1
    active_target="$(readlink "$DEPLOY_ROOT/current")"
    [[ "$active_target" =~ ^releases/[0-9]+-[1-9][0-9]*-[a-f0-9]{40}$ ]] || return 1
    active_dir="$DEPLOY_ROOT/$active_target"
    prepare_previous_application "$active_dir/$MANIFEST_NAME" "$candidate_schema" || return 1
    DATABASE_IMAGE=$candidate_database
    configure_compose "$active_dir"
    verify_database_health || return 1
    run_stage rollback docker "${COMPOSE_ARGS[@]}" up -d --no-build --no-deps --wait labeling-server labeling-caddy || return 1
    smoke_check "rollback-" || return 1
}

deploy_release() {
    receive_release
    local release_dir="$DEPLOY_ROOT/releases/$RELEASE_ID"
    configure_compose "$release_dir"
    preflight_compose
    run_stage backup "$BACKUP_COMMAND"
    grep -Fxq STUDY_BACKUP_VERIFIED "$EVIDENCE_DIR/backup.log" || fail "backup command did not confirm a verified backup"
    run_stage database docker "${COMPOSE_ARGS[@]}" up -d --no-build --wait labeling-database
    run_stage prepare docker "${COMPOSE_ARGS[@]}" up --no-build --no-deps --abort-on-container-exit --exit-code-from labeling-study-prepare labeling-study-prepare
    if ! run_stage runtime docker "${COMPOSE_ARGS[@]}" up -d --no-build --wait labeling-server labeling-caddy; then
        if ! automatic_image_rollback; then
            printf '%s\n' "automatic image rollback failed" >> "$EVIDENCE_DIR/diagnostic.log"
        fi
        STAGE="runtime"
        fail "runtime health verification failed"
    fi
    if ! smoke_check ""; then
        if ! automatic_image_rollback; then
            printf '%s\n' "automatic image rollback failed" >> "$EVIDENCE_DIR/diagnostic.log"
        fi
        STAGE="smoke"
        fail "external HTTPS smoke check failed"
    fi
    STAGE="state-publication"
    publish_deployment
    STAGE="complete"
    printf 'DEPLOY_VPS_SUCCEEDED %s %s\n' "$RELEASE_ID" "$EVIDENCE_DIR"
}

rollback_release() {
    [[ -L "$DEPLOY_ROOT/current" && -L "$DEPLOY_ROOT/previous" ]] || fail "current and previous releases are required for rollback"
    local current_target previous_target current_dir previous_dir active_schema highest current_server current_database
    current_target="$(readlink "$DEPLOY_ROOT/current")"
    previous_target="$(readlink "$DEPLOY_ROOT/previous")"
    [[ "$current_target" =~ ^releases/[0-9]+-[1-9][0-9]*-[a-f0-9]{40}$ && "$previous_target" =~ ^releases/[0-9]+-[1-9][0-9]*-[a-f0-9]{40}$ ]] || fail "release state target is invalid"
    current_dir="$DEPLOY_ROOT/$current_target"
    previous_dir="$DEPLOY_ROOT/$previous_target"
    [[ -f "$DEPLOY_ROOT/state/active-schema-version" && ! -L "$DEPLOY_ROOT/state/active-schema-version" ]] || fail "active schema state is missing or unsafe"
    active_schema="$(<"$DEPLOY_ROOT/state/active-schema-version")"
    read_manifest "$current_dir/$MANIFEST_NAME"
    current_server=$SERVER_IMAGE
    current_database=$DATABASE_IMAGE
    prepare_previous_application "$previous_dir/$MANIFEST_NAME" "$active_schema"
    cp -- "$previous_dir/$MANIFEST_NAME" "$EVIDENCE_DIR/$MANIFEST_NAME"
    DATABASE_IMAGE=$current_database
    configure_compose "$previous_dir"
    verify_database_health
    if ! run_stage rollback docker "${COMPOSE_ARGS[@]}" up -d --no-build --no-deps --wait labeling-server labeling-caddy \
        || ! smoke_check "rollback-"; then
        SERVER_IMAGE=$current_server
        DATABASE_IMAGE=$current_database
        configure_compose "$current_dir"
        if ! run_stage rollback-restore docker "${COMPOSE_ARGS[@]}" up -d --no-build --no-deps --wait labeling-server labeling-caddy; then
            printf '%s\n' "active application restore failed" >> "$EVIDENCE_DIR/diagnostic.log"
        fi
        STAGE="rollback"
        fail "application rollback verification failed"
    fi
    STAGE="state-publication"
    atomic_link current "$previous_target"
    atomic_link previous "$current_target"
    highest="$(active_generation)"
    atomic_write "$DEPLOY_ROOT/state/deployment" "current=${previous_target#releases/} previous=${current_target#releases/} generation=$highest schema=$active_schema"
    STAGE="complete"
    printf 'DEPLOY_VPS_ROLLBACK_SUCCEEDED %s %s\n' "${previous_target#releases/}" "$EVIDENCE_DIR"
}

parse_request "$@"
validate_deploy_root
exec 9> "$DEPLOY_ROOT/locks/deploy.lock"
flock -x 9
if [[ "$ACTION" == "deploy" ]]; then
    start_evidence "$REQUESTED_RELEASE_ID"
else
    start_evidence rollback
fi
validate_external_inputs

case "$ACTION" in
    deploy) deploy_release ;;
    rollback) rollback_release ;;
esac
