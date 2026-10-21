#!/bin/sh

set -eu
unset NODE_TEST_CONTEXT

fail_prerequisite() {
  printf 'DEPLOYMENT_HARNESS_PREREQUISITE: %s\n' "$1" >&2
  exit 2
}

command -v docker >/dev/null 2>&1 || fail_prerequisite "docker CLI is required; install Docker Engine with the Compose plugin"
command -v node >/dev/null 2>&1 || fail_prerequisite "Node.js is required; install the repository Node runtime"
command -v npm >/dev/null 2>&1 || fail_prerequisite "npm is required; run this harness from a complete Node.js installation"
command -v curl >/dev/null 2>&1 || fail_prerequisite "curl is required for the loopback edge check"
docker compose version >/dev/null 2>&1 || fail_prerequisite "Docker Compose plugin is required; install docker compose"
docker info >/dev/null 2>&1 || fail_prerequisite "Docker daemon is unavailable; start Docker and grant this user access"
LEGACY_ONLY=false
case "${1:-}" in
  "") ;;
  --legacy-only) LEGACY_ONLY=true; shift ;;
  *) fail_prerequisite "supported argument: --legacy-only" ;;
esac
[ "$#" -eq 0 ] || fail_prerequisite "supported argument: --legacy-only"
READINESS_TEST_IMAGE=${LABELER_READINESS_TEST_IMAGE:-labeler-copilot369-local:b5cddf3}
CLEAN_SERVER_IMAGE=$(docker image inspect --format '{{.Id}}' "$READINESS_TEST_IMAGE" 2>/dev/null) \
  || fail_prerequisite "Docker image from LABELER_READINESS_TEST_IMAGE (or the documented local default) is unavailable"
printf 'HARNESS_SERVER_IMAGE_ID=%s\n' "$CLEAN_SERVER_IMAGE"

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
EVIDENCE_DIR=${HARNESS_EVIDENCE_DIR:-}
if [ -n "$EVIDENCE_DIR" ] && [ ! -d "$EVIDENCE_DIR" ]; then
  fail_prerequisite "HARNESS_EVIDENCE_DIR must name an existing directory"
fi
if [ -n "$EVIDENCE_DIR" ]; then
  printf '%s\n' "$CLEAN_SERVER_IMAGE" > "$EVIDENCE_DIR/server-image-id.txt"
fi
TEMP_BASE=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
[ -d "$TEMP_BASE" ] || fail_prerequisite "temporary directory $TEMP_BASE does not exist"

umask 077
WORK_DIR=$(mktemp -d "$TEMP_BASE/labeler-deployment-harness.XXXXXX")
RUN_ID=$(basename "$WORK_DIR" | tr '[:upper:].' '[:lower:]-')
CLEAN_PROJECT="${RUN_ID}-clean"
EXISTING_PROJECT="${RUN_ID}-existing"
CLEAN_DIR="$WORK_DIR/clean"
EXISTING_DIR="$WORK_DIR/existing"
HANDOFF_CONTAINER_NAME=
HANDOFF_HELPER_IMAGE=python:3.12-alpine
HANDOFF_PROJECT=
HANDOFF_RUNTIME=
mkdir -m 700 "$CLEAN_DIR" "$EXISTING_DIR"
HANDOFF_STARTED=false
HANDOFF_LOCK_HELD_THROUGH_PREPARE=false
HANDOFF_CONTEXT_BOUND=false
HANDOFF_CONTAINER_REMOVED=false
HANDOFF_STATE_REMOVED=false
HANDOFF_OWNER_CLEANED=false

compose_for() {
  project=$1
  runtime=$2
  shift 2
  if [ "$runtime" = "$CLEAN_DIR" ]; then
    docker compose -p "$project" --env-file "$runtime/compose.env" \
      -f "$ROOT/deployment/docker-compose.yml" -f "$ROOT/deployment/docker-compose.clean.yml" -f "$runtime/harness.yml" "$@"
  elif [ "${1:-}" = "-f" ]; then
    extra=$2
    shift 2
    docker compose -p "$project" --env-file "$runtime/compose.env" \
      -f "$ROOT/deployment/docker-compose.yml" -f "$extra" -f "$runtime/harness.yml" "$@"
  else
    docker compose -p "$project" --env-file "$runtime/compose.env" \
      -f "$ROOT/deployment/docker-compose.yml" -f "$runtime/harness.yml" "$@"
  fi
}

report_prepare_probe_diagnostic() {
  probe_name=$1
  probe_status=$2
  probe_output=$3
  probe_diagnostic_json=$(printf '%s' "$probe_output" \
    | node "$ROOT/test/support/prepare-probe-diagnostic.js" "$probe_name" "$probe_status")
  printf '%s\n' "$probe_diagnostic_json" >&2
  if [ -n "$EVIDENCE_DIR" ]; then
    printf '%s\n' "$probe_diagnostic_json" > "$EVIDENCE_DIR/$CLEAN_PROJECT-$probe_name-diagnostic.json"
  fi
}

compose_for_existing_clean_profiles() {
  project=$1
  runtime=$2
  shift 2
  docker compose -p "$project" --env-file "$runtime/compose.env" \
    -f "$ROOT/deployment/docker-compose.yml" \
    -f "$ROOT/deployment/docker-compose.existing.yml" \
    -f "$ROOT/deployment/docker-compose.clean.yml" \
    -f "$runtime/retired-mode.yml" -f "$runtime/handoff.yml" -f "$runtime/harness.yml" "$@"
}

cleanup_error=0

capture_prepare_diagnostics() {
  project=$1
  runtime=$2
  extra=${3:-}
  raw_log="$WORK_DIR/$project-prepare.raw.log"
  if [ ! -f "$runtime/compose.env" ] || [ ! -f "$runtime/harness.yml" ]; then
    return 0
  fi
  if [ -n "$extra" ]; then
    if compose_for "$project" "$runtime" -f "$extra" logs --no-color labeling-study-prepare > "$raw_log" 2>&1; then
      :
    else
      printf 'PREPARE_DIAGNOSTICS_UNAVAILABLE\n' > "$raw_log"
    fi
  else
    if compose_for "$project" "$runtime" logs --no-color labeling-study-prepare > "$raw_log" 2>&1; then
      :
    else
      printf 'PREPARE_DIAGNOSTICS_UNAVAILABLE\n' > "$raw_log"
    fi
  fi
  if [ -n "$EVIDENCE_DIR" ]; then
    node --input-type=module - "$runtime" "$raw_log" > "$EVIDENCE_DIR/$project-prepare-redacted.log" <<'NODE'
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";

const [runtime, logPath] = process.argv.slice(2);
const secrets = new Set();
const collectStrings = value => {
    if (typeof value === "string") secrets.add(value);
    else if (Array.isArray(value)) value.forEach(collectStrings);
    else if (value && typeof value === "object") Object.values(value).forEach(collectStrings);
};
for (const name of ["database-password", "database-password-postgres", "session-current", "session-previous",
    "account-passwords.json", "validation-account-passwords.json", "study-account-manifest.json",
    "validation-study-account-manifest.json", "multi-study-e2e-credentials.json", "integration.env",
    "legacy-retirement.pgpass"]) {
    const filePath = path.join(runtime, name);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    secrets.add(content.trim());
    if (name === "integration.env") {
        for (const line of content.split(/\r?\n/)) {
            const separator = line.indexOf("=");
            if (separator > 0) secrets.add(line.slice(separator + 1));
        }
    }
    if (name === "legacy-retirement.pgpass") {
        for (const line of content.split(/\r?\n/)) secrets.add(line.split(":").at(-1));
    }
    try {
        collectStrings(JSON.parse(content));
    } catch (_error) {
        continue;
    }
}
let output = readFileSync(logPath, "utf8");
for (const secret of [...secrets].filter(Boolean).sort((left, right) => right.length - left.length)) {
    output = output.replaceAll(secret, "[REDACTED]");
}
output = output.replace(/\$argon2id\$[^\s,"}]*/g, "[REDACTED_PASSWORD_HASH]")
    .replace(/__Host-(?:session|login-csrf)=[^;\s]+/g, "[REDACTED_COOKIE]");
process.stdout.write(output);
NODE
  fi
}

stop_handoff_owner() {
  [ "$HANDOFF_STARTED" = true ] || return 0
  [ "$HANDOFF_CONTAINER_REMOVED" = false ] || return 0

  if running=$(docker inspect --format '{{.State.Running}}' "$HANDOFF_CONTAINER_NAME"); then
    if [ "$running" = true ]; then
      if docker stop --time 15 "$HANDOFF_CONTAINER_NAME" >/dev/null; then
        :
      else
        cleanup_error=1
      fi
    fi
  else
    cleanup_error=1
  fi

  if owner_log=$(docker logs "$HANDOFF_CONTAINER_NAME"); then
    printf '%s\n' "$owner_log" > "$WORK_DIR/$HANDOFF_PROJECT-handoff-owner.log"
    case "$owner_log" in
      *HANDOFF_CLEANED*) HANDOFF_OWNER_CLEANED=true ;;
      *) cleanup_error=1 ;;
    esac
  else
    cleanup_error=1
  fi

  if docker rm --force "$HANDOFF_CONTAINER_NAME" >/dev/null; then
    if docker inspect "$HANDOFF_CONTAINER_NAME" >/dev/null 2>&1; then
      cleanup_error=1
    else
      HANDOFF_CONTAINER_REMOVED=true
    fi
  else
    cleanup_error=1
  fi
  if [ -e "$HANDOFF_RUNTIME/host-control/host-state" ] || [ -e "$HANDOFF_RUNTIME/host-control/host-handoff" ]; then
    if docker run --rm --network none --read-only --user 0 --cap-drop ALL --cap-add DAC_OVERRIDE \
      --mount "type=bind,src=$ROOT,dst=/workspace,readonly" \
      --mount "type=bind,src=$HANDOFF_RUNTIME/host-control,dst=/fixture" \
      "$HANDOFF_HELPER_IMAGE" python3 -B /workspace/test/support/locked-prepare-handoff.py --cleanup >/dev/null 2>&1; then
      :
    else
      cleanup_error=1
    fi
  fi
  if [ ! -e "$HANDOFF_RUNTIME/host-control/host-state" ] && [ ! -e "$HANDOFF_RUNTIME/host-control/host-handoff" ]; then
    HANDOFF_STATE_REMOVED=true
  else
    cleanup_error=1
  fi

  node --input-type=module - "$WORK_DIR/$HANDOFF_PROJECT-handoff-owner.json" \
    "$HANDOFF_CONTAINER_NAME" "$HANDOFF_STARTED" "$HANDOFF_LOCK_HELD_THROUGH_PREPARE" \
    "$HANDOFF_CONTEXT_BOUND" "$HANDOFF_OWNER_CLEANED" "$HANDOFF_CONTAINER_REMOVED" \
    "$HANDOFF_STATE_REMOVED" <<'NODE'
import {writeFileSync} from "node:fs";
const [path, name, started, lockHeldThroughPrepare, contextBound, ownerCleaned, containerRemoved, stateRemoved] = process.argv.slice(2);
writeFileSync(path, `${JSON.stringify({name, started: started === "true", lockHeldThroughPrepare: lockHeldThroughPrepare === "true",
    contextBound: contextBound === "true", ownerCleaned: ownerCleaned === "true",
    containerRemoved: containerRemoved === "true", stateRemoved: stateRemoved === "true"})}\n`);
NODE
  if [ "$HANDOFF_OWNER_CLEANED" != true ] || [ "$HANDOFF_CONTAINER_REMOVED" != true ] \
      || [ "$HANDOFF_STATE_REMOVED" != true ]; then
    cleanup_error=1
  fi
}

cleanup_project() {
  project=$1
  runtime=$2
  extra=${3:-}

  receipt_prefix="$WORK_DIR/$project"
  absence_verified=true
  [ -f "$receipt_prefix.ports" ] || : > "$receipt_prefix.ports"
  if containers=$(docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Names}}'); then
    printf '%s\n' "$containers" > "$receipt_prefix.containers"
  else
    printf '\n' > "$receipt_prefix.containers"
    absence_verified=false
    cleanup_error=1
  fi
  if networks=$(docker network ls --filter "label=com.docker.compose.project=$project" --format '{{.Name}}'); then
    printf '%s\n' "$networks" > "$receipt_prefix.networks"
  else
    printf '\n' > "$receipt_prefix.networks"
    absence_verified=false
    cleanup_error=1
  fi
  if volumes=$(docker volume ls --filter "label=com.docker.compose.project=$project" --format '{{.Name}}'); then
    printf '%s\n' "$volumes" > "$receipt_prefix.volumes"
  else
    printf '\n' > "$receipt_prefix.volumes"
    absence_verified=false
    cleanup_error=1
  fi
  image_reference=
  if [ -f "$receipt_prefix.image-reference" ]; then
    read image_reference < "$receipt_prefix.image-reference"
  fi
  if [ -n "$image_reference" ]; then
    if images=$(docker image ls --filter "reference=$image_reference" --format '{{.Repository}}:{{.Tag}}'); then
      printf '%s\n' "$images" > "$receipt_prefix.images"
    else
      printf '\n' > "$receipt_prefix.images"
      absence_verified=false
      cleanup_error=1
    fi
  else
    : > "$receipt_prefix.images"
  fi

  if [ -f "$runtime/compose.env" ] && [ -f "$runtime/harness.yml" ]; then
    if [ -n "$extra" ]; then
      if compose_for "$project" "$runtime" -f "$extra" down --remove-orphans >/dev/null 2>&1; then
        :
      else
        cleanup_error=1
      fi
    else
      if compose_for "$project" "$runtime" down --remove-orphans >/dev/null 2>&1; then
        :
      else
        cleanup_error=1
      fi
    fi
  fi

  if containers=$(docker ps -aq --filter "label=com.docker.compose.project=$project"); then
    for container in $containers; do
      if docker rm --force "$container" >/dev/null; then
        :
      else
        cleanup_error=1
      fi
    done
  else
    absence_verified=false
    cleanup_error=1
  fi
  if [ "$HANDOFF_STARTED" = true ] && [ "$HANDOFF_PROJECT" = "$project" ]; then
    stop_handoff_owner
  fi
  if networks=$(docker network ls -q --filter "label=com.docker.compose.project=$project"); then
    for network in $networks; do
      if docker network rm "$network" >/dev/null; then
        :
      else
        cleanup_error=1
      fi
    done
  else
    absence_verified=false
    cleanup_error=1
  fi
  if volumes=$(docker volume ls -q --filter "label=com.docker.compose.project=$project"); then
    for volume in $volumes; do
      if docker volume rm "$volume" >/dev/null; then
        :
      else
        cleanup_error=1
      fi
    done
  else
    absence_verified=false
    cleanup_error=1
  fi
  if [ -n "$image_reference" ]; then
    if images=$(docker image ls -q --filter "reference=$image_reference"); then
      if [ -n "$images" ]; then
        if docker image rm "$image_reference" >/dev/null; then
          :
        else
          cleanup_error=1
        fi
      fi
    else
      absence_verified=false
      cleanup_error=1
    fi
  fi

  if containers=$(docker ps -aq --filter "label=com.docker.compose.project=$project"); then
    [ -z "$containers" ] || absence_verified=false
  else
    absence_verified=false
  fi
  if networks=$(docker network ls -q --filter "label=com.docker.compose.project=$project"); then
    [ -z "$networks" ] || absence_verified=false
  else
    absence_verified=false
  fi
  if volumes=$(docker volume ls -q --filter "label=com.docker.compose.project=$project"); then
    [ -z "$volumes" ] || absence_verified=false
  else
    absence_verified=false
  fi
  if [ -n "$image_reference" ]; then
    if images=$(docker image ls -q --filter "reference=$image_reference"); then
      [ -z "$images" ] || absence_verified=false
    else
      absence_verified=false
    fi
  fi
  [ "$absence_verified" = true ] || cleanup_error=1
  printf '%s\n' "$absence_verified" > "$receipt_prefix.verified"
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ]; then
    for project in "$CLEAN_PROJECT" "$EXISTING_PROJECT"; do
      if diagnostics=$(docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Names}} {{.Status}} {{.Ports}}'); then
        if [ -n "$EVIDENCE_DIR" ]; then
          printf 'project=%s\n%s\n' "$project" "$diagnostics" >> "$EVIDENCE_DIR/cleanup-diagnostics.txt"
        else
          printf 'CLEANUP_DIAGNOSTIC project=%s resources=%s\n' "$project" "${diagnostics:-none}" >&2
        fi
      else
        cleanup_error=1
      fi
    done
    capture_prepare_diagnostics "$CLEAN_PROJECT" "$CLEAN_DIR"
    capture_prepare_diagnostics "$EXISTING_PROJECT" "$EXISTING_DIR" "$ROOT/deployment/docker-compose.existing.yml"
  fi
  cleanup_project "$CLEAN_PROJECT" "$CLEAN_DIR"
  cleanup_project "$EXISTING_PROJECT" "$EXISTING_DIR" "$ROOT/deployment/docker-compose.existing.yml"
resource_evidence=$(node --input-type=module - "$WORK_DIR" "$CLEAN_PROJECT" "$EXISTING_PROJECT" <<'NODE'
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";

const [directory, cleanName, existingName] = process.argv.slice(2);
const lines = name => readFileSync(path.join(directory, name), "utf8").split("\n").filter(Boolean);
const project = name => {
    const handoffOwnerPath = path.join(directory, `${name}-handoff-owner.json`);
    const handoffOwner = existsSync(handoffOwnerPath) ? JSON.parse(readFileSync(handoffOwnerPath, "utf8")) : {
        name: `${name}-handoff-owner`, started: false, lockHeldThroughPrepare: false, contextBound: false,
        ownerCleaned: false, containerRemoved: true, stateRemoved: true,
    };
    return {
        name,
        containers: lines(`${name}.containers`),
        networks: lines(`${name}.networks`),
        volumes: lines(`${name}.volumes`),
        images: lines(`${name}.images`),
        absenceVerified: lines(`${name}.verified`)[0] === "true",
        ports: lines(`${name}.ports`),
        handoffOwner,
    };
};
process.stdout.write(JSON.stringify([project(cleanName), project(existingName)]));
NODE
)
  if rm -rf "$WORK_DIR"; then
    :
  else
    cleanup_error=1
  fi
  if [ -e "$WORK_DIR" ]; then
    temporary_directory_removed=false
    cleanup_error=1
  else
    temporary_directory_removed=true
  fi
  final_status=$status
  if [ "$cleanup_error" -ne 0 ] && [ "$final_status" -eq 0 ]; then
    final_status=1
  fi
  if cleanup_receipt=$(node --input-type=module - "$status" "$final_status" "$cleanup_error" "$temporary_directory_removed" "$resource_evidence" <<'NODE'
const [workloadExit, finalExit, cleanupError, temporaryDirectoryRemoved, encodedResources] = process.argv.slice(2);
const projects = JSON.parse(encodedResources);
const handoffOwnerVerified = projects.every(project => !project.handoffOwner.started
    || (project.handoffOwner.lockHeldThroughPrepare && project.handoffOwner.contextBound
        && project.handoffOwner.ownerCleaned && project.handoffOwner.containerRemoved && project.handoffOwner.stateRemoved));
const cleanupVerified = cleanupError === "0" && temporaryDirectoryRemoved === "true"
    && projects.every(project => project.absenceVerified) && handoffOwnerVerified;
process.stdout.write(`${JSON.stringify({
    workloadExitCode: Number(workloadExit),
    cleanupVerified,
    temporaryDirectoryRemoved: temporaryDirectoryRemoved === "true",
    projects,
})}\n`);
NODE
  ); then
    if [ -n "$EVIDENCE_DIR" ]; then
      if printf '%s' "$cleanup_receipt" > "$EVIDENCE_DIR/cleanup-receipt.json"; then
        :
      else
        final_status=1
      fi
    else
      printf '%s' "$cleanup_receipt"
    fi
  else
    final_status=1
  fi
  if [ "$cleanup_error" -ne 0 ]; then
    printf 'DEPLOYMENT_HARNESS_CLEANUP_UNCONFIRMED projects=%s,%s evidence=%s\n' \
      "$CLEAN_PROJECT" "$EXISTING_PROJECT" "${EVIDENCE_DIR:-stderr}"
    if [ "$final_status" -eq 0 ]; then final_status=1; fi
  fi
  exit "$final_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

set -- $(node --input-type=module <<'NODE'
import net from "node:net";
const servers = [];
const ports = [];
for (let index = 0; index < 4; index += 1) {
    const server = net.createServer();
    await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
    servers.push(server);
    ports.push(server.address().port);
}
if (new Set(ports).size !== ports.length) throw new Error("isolated runtime ports must be distinct");
for (const server of servers) await new Promise(resolve => server.close(resolve));
process.stdout.write(ports.join(" "));
NODE
)
CLEAN_HTTP_PORT=$1
CLEAN_HTTPS_PORT=$2
EXISTING_HTTP_PORT=$3
EXISTING_HTTPS_PORT=$4

write_runtime() {
  runtime=$1
  project=$2
  mode=$3
  HTTP_PORT=$4
  HTTPS_PORT=$5

  printf 'http=%s\nhttps=%s\n' "$HTTP_PORT" "$HTTPS_PORT" > "$WORK_DIR/$project.ports"

  node --input-type=module > "$runtime/database-password" <<'NODE'
import {randomBytes} from "node:crypto";
process.stdout.write(randomBytes(32).toString("base64url"));
NODE
  cp "$runtime/database-password" "$runtime/database-password-postgres"
  node --input-type=module > "$runtime/session-current" <<'NODE'
import {randomBytes} from "node:crypto";
process.stdout.write(randomBytes(32).toString("base64url"));
NODE
  node --input-type=module > "$runtime/session-previous" <<'NODE'
import {randomBytes} from "node:crypto";
process.stdout.write(randomBytes(32).toString("base64url"));
NODE
  cat > "$runtime/study-config.json" <<'JSON'
{"studyKey":"pr-card-sorting-local","expectedCardCount":369,"participants":["javier","diego","pablo"],"loginUsernames":{"javier":"javier","diego":"diego","pablo":"pablo"}}
JSON
  node --input-type=module > "$runtime/account-passwords.json" <<'NODE'
import {randomBytes} from "node:crypto";
process.stdout.write(JSON.stringify(Array.from({length: 3}, () => randomBytes(32).toString("base64url"))));
NODE
  chmod 0400 "$runtime/account-passwords.json"
  npm run --silent credentials:generate -- \
    --study-config "$runtime/study-config.json" \
    --output "$runtime/study-account-manifest.json" \
    < "$runtime/account-passwords.json" >/dev/null
  cat > "$runtime/validation-study-config.json" <<'JSON'
{"studyKey":"pr-card-sorting-validation-30","expectedCardCount":30,"participants":["javier","diego","pablo"],"loginUsernames":{"javier":"javier-30","diego":"diego-30","pablo":"pablo-30"}}
JSON
  node --input-type=module > "$runtime/validation-account-passwords.json" <<'NODE'
import {randomBytes} from "node:crypto";
process.stdout.write(JSON.stringify(Array.from({length: 3}, () => randomBytes(32).toString("base64url"))));
NODE
  chmod 0400 "$runtime/validation-account-passwords.json"
  npm run --silent credentials:generate -- \
    --study-config "$runtime/validation-study-config.json" \
    --output "$runtime/validation-study-account-manifest.json" \
    < "$runtime/validation-account-passwords.json" >/dev/null
  node --input-type=module - "$runtime/account-passwords.json" "$runtime/validation-account-passwords.json" > "$runtime/multi-study-e2e-credentials.json" <<'NODE'
import {readFileSync} from "node:fs";
const [currentPath, validationPath] = process.argv.slice(2);
const current = JSON.parse(readFileSync(currentPath, "utf8"));
const validation = JSON.parse(readFileSync(validationPath, "utf8"));
if (![current, validation].every(passwords => Array.isArray(passwords)
    && passwords.length === 3 && passwords.every(password => typeof password === "string" && password))) {
    throw new Error("task-scoped participant credentials are invalid");
}
if (new Set([...current, ...validation]).size !== 6) throw new Error("six synthetic credentials must be distinct");
process.stdout.write(`${JSON.stringify({
    javier: current[0], diego: current[1], pablo: current[2],
    "javier-30": validation[0], "diego-30": validation[1], "pablo-30": validation[2],
})}\n`);
NODE
  cat > "$runtime/study-profiles.json" <<'JSON'
{"profiles":[{"config":"/run/config/studies/current.json","csv":"/labeling/data/copilot-369-cards.csv","accountManifest":"/run/secrets/studies/current.json","enrichmentEnabled":false},{"config":"/run/config/studies/validation-30.json","csv":"/labeling/data/validation-30-cards.csv","accountManifest":"/run/secrets/studies/validation-30.json","enrichmentEnabled":false}]}
JSON
  chmod 0400 "$runtime/validation-study-config.json" "$runtime/study-profiles.json" \
    "$runtime/validation-study-account-manifest.json" "$runtime/multi-study-e2e-credentials.json"
  chmod 0400 "$runtime/database-password" "$runtime/session-current" "$runtime/session-previous" \
    "$runtime/study-config.json" "$runtime/study-account-manifest.json"
  chmod 0444 "$runtime/database-password-postgres"

  stage_node_container_inputs "$runtime" \
    database-password session-current session-previous study-account-manifest.json \
    study-profiles.json study-config.json validation-study-config.json validation-study-account-manifest.json

  cat > "$runtime/Caddyfile" <<CADDY
http://localhost {
    redir https://localhost:${HTTPS_PORT}{uri} permanent
}
https://localhost {
    tls internal
    @actuator path /actuator /actuator/*
    respond @actuator 404
    reverse_proxy labeling-server:3000
}
CADDY
  chmod 0400 "$runtime/Caddyfile"
  cp "$runtime/Caddyfile" "$runtime/Caddyfile-caddy"
  chmod 0444 "$runtime/Caddyfile-caddy"

  cat > "$runtime/compose.env" <<ENV
DATABASE_NAME=labeling_harness
DATABASE_USER=labeling_harness
DATABASE_PASSWORD_HOST_PATH=$runtime/container-inputs/database-password
DATABASE_PASSWORD_DATABASE_HOST_PATH=$runtime/database-password-postgres
SESSION_SECRET_CURRENT_HOST_PATH=$runtime/container-inputs/session-current
SESSION_SECRET_PREVIOUS_HOST_PATH=$runtime/container-inputs/session-previous
STUDY_ACCOUNT_MANIFEST_HOST_PATH=$runtime/container-inputs/study-account-manifest.json
STUDY_DATABASE_MODE=$mode
PUBLIC_HOSTNAME=localhost
APP_ORIGIN=https://localhost:$HTTPS_PORT
GITHUB_ENRICHMENT_ENABLED=false
LABELER_SERVER_IMAGE=$CLEAN_SERVER_IMAGE
ENV
  cat >> "$runtime/compose.env" <<ENV
STUDY_VALIDATION_ACCOUNT_MANIFEST_HOST_PATH=$runtime/container-inputs/validation-study-account-manifest.json
STUDY_PROFILES_INPUT_HOST_PATH=$runtime/container-inputs/study-profiles.json
STUDY_CURRENT_CONFIG_HOST_PATH=$runtime/container-inputs/study-config.json
STUDY_VALIDATION_CONFIG_HOST_PATH=$runtime/container-inputs/validation-study-config.json
ENV
  chmod 0600 "$runtime/compose.env"

  cat > "$runtime/harness.yml" <<YAML
services:
  labeling-database:
    container_name: ${project}-database
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
      - FOWNER
      - SETGID
      - SETUID
    healthcheck:
      test: [ "CMD-SHELL", "pg_isready -U \$\$POSTGRES_USER -d \$\$POSTGRES_DB" ]
      interval: 2s
      timeout: 2s
      retries: 30
      start_period: 5s
    tmpfs: !override
      - /tmp:rw,noexec,nosuid,nodev,size=64m
      - /var/run/postgresql:rw,noexec,nosuid,nodev,size=16m,uid=70,gid=70
YAML
  if [ "$mode" = "existing" ]; then
    cat >> "$runtime/harness.yml" <<YAML
    image: postgres:17.6-alpine
    build: !reset null
    volumes: !override
      - data:/var/lib/postgresql/data
      - $runtime/database-password-postgres:/run/secrets/database-password:ro
      - $ROOT/schema/01_definitions_schema.sql:/docker-entrypoint-initdb.d/01_definitions_schema.sql:ro
      - $ROOT/schema/02_definitions_function.sql:/docker-entrypoint-initdb.d/02_definitions_function.sql:ro
      - $ROOT/schema/03_definitions_procedure.sql:/docker-entrypoint-initdb.d/03_definitions_procedure.sql:ro
      - $ROOT/schema/04_definitions_view.sql:/docker-entrypoint-initdb.d/04_definitions_view.sql:ro
      - $ROOT/schema/05_implementations_function.sql:/docker-entrypoint-initdb.d/05_implementations_function.sql:ro
      - $ROOT/schema/06_implementations_procedure.sql:/docker-entrypoint-initdb.d/06_implementations_procedure.sql:ro
YAML
  else
    cat >> "$runtime/harness.yml" <<YAML
    image: ${project}-database-fixture
    build: !reset null
    pull_policy: never
    volumes:
      - $runtime/database-password-postgres:/run/secrets/database-password:ro
YAML
  fi
  if [ "$mode" = "existing" ]; then
    cat >> "$runtime/harness.yml" <<YAML
  labeling-study-prepare:
    container_name: ${project}-prepare
    image: $CLEAN_SERVER_IMAGE
    build: !reset null
    pull_policy: never
    tmpfs: !override
      - /tmp:rw,noexec,nosuid,nodev,size=64m
      - /run/labeler-release:rw,noexec,nosuid,nodev,size=1m,uid=0,gid=1000,mode=0750
    volumes:
      - "$ROOT/scripts:/labeling/scripts:ro"
      - "$ROOT/util:/labeling/util:ro"
      - "$ROOT/schema/migrations:/labeling/schema/migrations:ro"
YAML
  else
    cat >> "$runtime/harness.yml" <<YAML
  labeling-study-prepare:
    container_name: ${project}-prepare
    image: $CLEAN_SERVER_IMAGE
    build: !reset null
    pull_policy: never
    tmpfs: !override
      - /tmp:rw,noexec,nosuid,nodev,size=64m
      - /run/labeler-release:rw,noexec,nosuid,nodev,size=1m,uid=0,gid=1000,mode=0750
    volumes:
      - "$ROOT/scripts:/labeling/scripts:ro"
      - "$ROOT/util:/labeling/util:ro"
      - "$ROOT/schema/migrations:/labeling/schema/migrations:ro"
YAML
  fi
  cat >> "$runtime/harness.yml" <<YAML
  labeling-server:
    container_name: ${project}-server
    image: $CLEAN_SERVER_IMAGE
    build: !reset null
    pull_policy: never
    tmpfs: !override
      - /tmp:rw,noexec,nosuid,nodev,size=64m
      - /labeling/logs:rw,noexec,nosuid,nodev,size=32m,uid=1000,gid=1000
YAML
  cat >> "$runtime/harness.yml" <<YAML
  labeling-caddy:
    container_name: ${project}-caddy
    cap_add:
      - NET_BIND_SERVICE
    tmpfs: !override
      - /tmp:rw,noexec,nosuid,nodev,size=32m
    volumes:
      - $runtime/Caddyfile-caddy:/etc/caddy/Caddyfile:ro
    ports: !override
      - "127.0.0.1:${HTTP_PORT}:80"
      - "127.0.0.1:${HTTPS_PORT}:443"
volumes:
  data:
    name: ${project}-data
  caddy-data:
    name: ${project}-caddy-data
  caddy-config:
    name: ${project}-caddy-config
networks:
  default:
    name: ${project}-network
YAML
}

stage_node_container_inputs() {
  stage_runtime=$1
  shift
  node "$ROOT/test/support/container-input-staging.js" files \
    "$stage_runtime" "$stage_runtime" "$HANDOFF_HELPER_IMAGE" "$@"
}

write_existing_inputs() {
  runtime=$1
  project=$2
  password=$(cat "$runtime/database-password")
  mkdir -m 700 "$runtime/backup"
  printf '%s\n' "labeling-database:5432:labeling_harness:labeling_harness:$password" > "$runtime/legacy-retirement.pgpass"
  chmod 0400 "$runtime/legacy-retirement.pgpass"
  stage_node_container_inputs "$runtime" legacy-retirement.pgpass
  mkdir -m 0711 "$runtime/container-inputs/backup"
  cat >> "$runtime/compose.env" <<ENV
LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler
LEGACY_BACKUP_DIRECTORY=$runtime/container-inputs/backup
LEGACY_BACKUP_ARCHIVE_FILE=legacy.dump
LEGACY_BACKUP_MANIFEST_FILE=legacy.manifest.json
PGPASSFILE_HOST_PATH=$runtime/container-inputs/legacy-retirement.pgpass
ENV
  chmod 0600 "$runtime/compose.env" "$runtime/harness.yml"
}

prepare_empty_origin() {
  database_host=$1
  runtime=$2
  project=$3
  origin_mode=${4:-empty}
  mkdir -m 700 "$runtime/host-control"
  node --input-type=module - "$database_host" "$runtime" "$project" "$origin_mode" <<'NODE'
import {randomBytes} from "node:crypto";
import {chmod, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {classifyStudyReadiness, probeStudyNormalization} from "./util/study-readiness.js";

const [host, runtime, project, originMode] = process.argv.slice(2);
const databasePassword = (await readFile(path.join(runtime, "database-password"), "utf8")).trim();
const inspectionPassword = randomBytes(32).toString("base64url");
const options = {host, port: 5432, user: "labeling_harness", database: "labeling_harness",
    password: databasePassword, max: 1, connectionTimeoutMillis: 5000};
const administrator = new pg.Pool(options);
try {
    await administrator.query(`CREATE ROLE labeler_inspection LOGIN PASSWORD '${inspectionPassword}'`);
    await administrator.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await administrator.query("REVOKE TEMP ON DATABASE labeling_harness FROM PUBLIC");
    await administrator.query("GRANT pg_read_all_stats TO labeler_inspection");
    await administrator.query("GRANT CONNECT ON DATABASE labeling_harness TO labeler_inspection");
    await administrator.query("GRANT USAGE ON SCHEMA public TO labeler_inspection");
    await administrator.query("GRANT SELECT ON ALL TABLES IN SCHEMA public TO labeler_inspection");
    await administrator.query("GRANT EXECUTE ON FUNCTION pg_control_system() TO labeler_inspection");
    await administrator.query("ALTER DEFAULT PRIVILEGES FOR ROLE labeling_harness IN SCHEMA public GRANT SELECT ON TABLES TO labeler_inspection");
} finally {
    await administrator.end();
}
const inspectionPath = path.join(runtime, "inspection-password");
await writeFile(inspectionPath, `${inspectionPassword}\n`, {mode: 0o400});
await chmod(inspectionPath, 0o400);
const inspector = new pg.Pool({...options, user: "labeler_inspection", password: inspectionPassword});
try {
    let origin;
    let normalization;
    if (originMode === "normalization") {
        normalization = await probeStudyNormalization({pool: inspector, profiles: [], requireRestrictedRole: true});
        origin = normalization.observation;
        if (normalization.applied015 || normalization.eligibility !== "eligible"
            || origin.schema !== "014_copilot_369_cardinality" || origin.dataBundle !== "empty") {
            throw new Error("retired database is not an eligible empty normalization origin");
        }
    } else {
        origin = await classifyStudyReadiness({pool: inspector, profiles: [], requireRestrictedRole: true});
        if (origin.schema === "empty" || origin.dataBundle !== "empty") {
            throw new Error("database is not a known migrated empty readonly origin");
        }
    }
    if (origin.readOnly.writersStopped !== true || origin.readOnly.grantsVerified !== true) {
        throw new Error("inspection role did not prove read-only grants and stopped writers");
    }
    origin.databaseIdentity.endpoint = `${host}:5432/labeling_harness`;
    origin.databaseIdentity.volume = `${project}-data:/var/lib/postgresql/data`;
    const observationPath = path.join(runtime, "host-control/prepare-origin.json");
    await writeFile(observationPath, `${JSON.stringify(origin)}\n`, {mode: 0o400});
    await chmod(observationPath, 0o400);
    if (normalization) {
        const probePath = path.join(runtime, "host-control/normalization-pre-probe.json");
        await writeFile(probePath, `${JSON.stringify(normalization)}\n`, {mode: 0o400});
        await chmod(probePath, 0o400);
    }
} finally {
    await inspector.end();
}
NODE
}

write_handoff_overlay() {
  runtime=$1
  cat > "$runtime/handoff.yml" <<YAML
services:
  labeling-study-prepare:
    volumes:
      - "$runtime/host-control/host-handoff/context.json:/run/labeler-release/context.json:ro"
    environment:
      LABELER_RELEASE_CONTEXT: /run/labeler-release/context.json
YAML
  chmod 0400 "$runtime/handoff.yml"
}

write_retired_mode_overlay() {
  runtime=$1
  cat > "$runtime/retired-mode.yml" <<'YAML'
services:
  labeling-study-prepare:
    environment:
      STUDY_DATABASE_MODE: clean
YAML
  chmod 0400 "$runtime/retired-mode.yml"
}

start_locked_handoff() {
  runtime=$1
  project=$2
  helper_script=${3:-/workspace/test/support/locked-prepare-handoff.py}
  HANDOFF_PROJECT=$project
  HANDOFF_RUNTIME=$runtime
  HANDOFF_CONTAINER_NAME="${project}-handoff-owner"
  HANDOFF_STARTED=false
  HANDOFF_LOCK_HELD_THROUGH_PREPARE=false
  HANDOFF_CONTEXT_BOUND=false
  HANDOFF_CONTAINER_REMOVED=false
  HANDOFF_STATE_REMOVED=false
  HANDOFF_OWNER_CLEANED=false
  docker run --detach --name "$HANDOFF_CONTAINER_NAME" --network none --read-only --user 0 \
    --cap-drop ALL --cap-add DAC_OVERRIDE --cap-add CHOWN \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
    --mount "type=bind,src=$ROOT,dst=/workspace,readonly" \
    --mount "type=bind,src=$runtime/host-control,dst=/fixture" \
    "$HANDOFF_HELPER_IMAGE" python3 -B "$helper_script" >/dev/null
  HANDOFF_STARTED=true
  HANDOFF_ATTESTATION=$(node "$ROOT/test/support/wait-for-docker-log.js" \
    "$HANDOFF_CONTAINER_NAME" HANDOFF_READY 30000)
  node --input-type=module - "$HANDOFF_ATTESTATION" "$runtime/host-control/prepare-origin.json" \
    "$WORK_DIR/$project-handoff-binding.json" <<'NODE'
import {readFileSync, writeFileSync} from "node:fs";
const [encodedAttestation, originPath, outputPath] = process.argv.slice(2);
const attestation = JSON.parse(encodedAttestation);
const origin = JSON.parse(readFileSync(originPath, "utf8"));
if (attestation.lockHeld !== true || attestation.fileUid !== 0 || attestation.fileGid !== 1000
    || attestation.fileMode !== 0o440 || attestation.directoryUid !== 0
    || attestation.directoryMode !== 0o700 || attestation.mountDirectoryUid !== 0
    || attestation.mountDirectoryMode !== 0o700 || attestation.sameHandoffFile !== true
    || JSON.stringify(attestation.candidate) !== JSON.stringify(attestation.receiptCandidate)
    || JSON.stringify(attestation.databaseIdentity) !== JSON.stringify(attestation.receiptDatabaseIdentity)
    || JSON.stringify(attestation.databaseIdentity) !== JSON.stringify(origin.databaseIdentity)
    || JSON.stringify(attestation.observation) !== JSON.stringify(origin)) {
    throw new Error("root handoff owner, candidate or live database binding is invalid");
}
writeFileSync(outputPath, `${JSON.stringify(attestation)}\n`, {mode: 0o600});
NODE
  lock_probe=$(docker exec "$HANDOFF_CONTAINER_NAME" python3 -B \
    /workspace/test/support/locked-prepare-handoff.py --probe)
  [ "$lock_probe" = "LOCK_HELD" ] || { printf 'prepare lock was not exclusive before startup\n' >&2; return 1; }
  HANDOFF_CONTEXT_BOUND=true
}

verify_clean_origin_unchanged() {
  database_host=$1
  runtime=$2
  node --input-type=module - "$database_host" "$runtime" <<'NODE'
import {readFile} from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {classifyStudyReadiness} from "./util/study-readiness.js";

const [host, runtime] = process.argv.slice(2);
const origin = JSON.parse(await readFile(path.join(runtime, "host-control/prepare-origin.json"), "utf8"));
const pool = new pg.Pool({host, port: 5432, user: "labeler_inspection", database: "labeling_harness",
    password: (await readFile(path.join(runtime, "inspection-password"), "utf8")).trim(),
    max: 1, connectionTimeoutMillis: 5000});
try {
    const actual = await classifyStudyReadiness({pool, profiles: [], requireRestrictedRole: true});
    if (actual.schema !== origin.schema || actual.dataBundle !== origin.dataBundle
        || actual.fingerprint !== origin.fingerprint || actual.schemaFingerprint !== origin.schemaFingerprint
        || actual.databaseIdentity.systemIdentifier !== origin.databaseIdentity.systemIdentifier
        || actual.databaseIdentity.databaseOid !== origin.databaseIdentity.databaseOid) {
        throw new Error("rejected context changed the readonly database origin");
    }
} finally {
    await pool.end();
}
NODE
}

verify_config() {
  project=$1
  runtime=$2
  http_port=$3
  https_port=$4
  mode=$5
  extra=${6:-}
  expected_context=${7:-false}
  compose_variant=${8:-standard}
  if [ -f "$runtime/rendered.json" ]; then
    chmod 0600 "$runtime/rendered.json"
  fi
  if [ "$compose_variant" = "existing-clean" ]; then
    compose_for_existing_clean_profiles "$project" "$runtime" config --format json > "$runtime/rendered.json"
  elif [ -n "$extra" ]; then
    compose_for "$project" "$runtime" -f "$extra" config --format json > "$runtime/rendered.json"
  else
    compose_for "$project" "$runtime" config --format json > "$runtime/rendered.json"
  fi
  expected_context_path=
  if [ "$expected_context" = true ]; then
    expected_context_path="$runtime/host-control/host-handoff/context.json"
  fi
  node --input-type=module - "$runtime/rendered.json" "$project" "$http_port" "$https_port" "$mode" "$expected_context" "$expected_context_path" "$CLEAN_SERVER_IMAGE" <<'NODE'
import {readFileSync} from "node:fs";
const [configPath, project, httpPort, httpsPort, mode, expectedContext, expectedContextPath, serverImage] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const services = config.services;
if (config.name !== project) throw new Error("rendered Compose project is not isolated");
if (config.volumes.data.name !== `${project}-data` || config.networks.default.name !== `${project}-network`) {
    throw new Error("rendered Compose storage or network is not isolated");
}
if (services["labeling-study-prepare"].image !== serverImage || services["labeling-server"].image !== serverImage) {
    throw new Error("prepare and server must use the validated local image ID");
}
const expectedContainers = new Set(["database", "prepare", "server", "caddy"].map(name => `${project}-${name}`));
for (const service of Object.values(services)) {
    if (!expectedContainers.has(service.container_name)) throw new Error("rendered container name is not isolated");
}
for (const [name, service] of Object.entries(services)) {
    const ports = service.ports ?? [];
    if (name !== "labeling-caddy" && ports.length > 0) {
        throw new Error(`${name} publishes a host port`);
    }
    for (const port of ports) {
        if (port.host_ip !== "127.0.0.1" || port.protocol !== "tcp") throw new Error("edge is not loopback TCP");
    }
}
const edgePorts = services["labeling-caddy"].ports.map(port => `${port.published}:${port.target}`).sort();
if (JSON.stringify(edgePorts) !== JSON.stringify([`${httpPort}:80`, `${httpsPort}:443`].sort())) {
    throw new Error("Caddy does not exclusively publish the selected harness ports");
}
const contextMounts = Object.values(services).flatMap(service => service.volumes ?? [])
    .filter(volume => volume.target === "/run/labeler-release/context.json");
if (expectedContext === "true") {
    if (contextMounts.length !== 1 || contextMounts[0].source !== expectedContextPath
        || contextMounts[0].read_only !== true || contextMounts[0].type !== "bind"
        || services["labeling-study-prepare"].environment.LABELER_RELEASE_CONTEXT !== "/run/labeler-release/context.json") {
        throw new Error("root handoff is not mounted readonly into prepare");
    }
    for (const serviceName of ["labeling-server", "labeling-caddy"]) {
        if ((services[serviceName].volumes ?? []).some(volume => volume.target === "/run/labeler-release/context.json")) {
            throw new Error(`${serviceName} receives the root handoff`);
        }
    }
} else if (contextMounts.length > 0 || services["labeling-study-prepare"].environment.LABELER_RELEASE_CONTEXT) {
    throw new Error("ordinary or existing preparation receives a release handoff");
}
if (services["labeling-server"].depends_on["labeling-study-prepare"].condition !== "service_completed_successfully") {
    throw new Error("server is not gated by current preparation success");
}
const cleanOnlyTargets = new Set([
    "/run/config/study-profiles.json", "/run/config/studies/current.json", "/run/config/studies/validation-30.json",
    "/run/secrets/studies/validation-30.json",
]);
const profileTargets = new Set([
    ...cleanOnlyTargets,
    "/run/secrets/studies/current.json",
]);
const prepareTargets = new Set((services["labeling-study-prepare"].volumes ?? []).map(volume => volume.target));
if (mode === "clean") {
    for (const target of profileTargets) {
        if (!prepareTargets.has(target)) throw new Error(`prepare is missing profile mount ${target}`);
    }
    if (services["labeling-study-prepare"].environment.STUDY_PROFILES_INPUT !== "/run/config/study-profiles.json") {
        throw new Error("prepare does not select the mounted profile descriptor");
    }
}
for (const serviceName of ["labeling-study-prepare", "labeling-server", "labeling-caddy"]) {
    const targets = (services[serviceName].volumes ?? []).map(volume => volume.target);
    if (mode === "existing" && targets.some(target => cleanOnlyTargets.has(target))) {
        throw new Error(`${serviceName} receives a clean-only mount`);
    }
    if (mode === "clean" && serviceName !== "labeling-study-prepare" && targets.some(target => profileTargets.has(target))) {
        throw new Error(`${serviceName} receives a profile mount`);
    }
}
NODE
  chmod 0400 "$runtime/rendered.json"
  if [ -n "$EVIDENCE_DIR" ] && [ "$runtime" = "$CLEAN_DIR" ]; then
    printf 'prepare_clean_only_mounts_present=true\nserver_clean_only_mounts_present=false\ncaddy_clean_only_mounts_present=false\nserver_depends_on_prepare_success=true\n' \
      > "$EVIDENCE_DIR/security-mount-assertions.txt"
  fi
}

snapshot() {
  project=$1
  runtime=$2
  extra=${3:-}
  if [ -n "$extra" ]; then
    compose_for "$project" "$runtime" -f "$extra" exec -T labeling-database psql -U labeling_harness -d labeling_harness -At -c "$SNAPSHOT_SQL"
  else
    compose_for "$project" "$runtime" exec -T labeling-database psql -U labeling_harness -d labeling_harness -At -c "$SNAPSHOT_SQL"
  fi
}

hash_pg_dump() {
  node --input-type=module -e '
import {createHash} from "node:crypto";
import {stdin} from "node:process";
const hash = createHash("sha256");
let dump = "";
for await (const chunk of stdin) dump += chunk;
dump = dump.replace(/^(\\(?:un)?restrict )\S+$/gm, "$1<normalized>");
process.stdout.write(`${hash.update(dump).digest("hex")}\n`);
'
}

database_schema_data_fingerprint() {
  project=$1
  if schema_dump=$(docker exec "${project}-database" sh -ec \
    'pg_dump -U labeling_harness -d labeling_harness --schema-only --schema=public --no-owner --no-privileges'); then
    :
  else
    printf 'could not capture isolated database schema fingerprint\n' >&2
    return 1
  fi
  if data_dump=$(docker exec "${project}-database" sh -ec \
    'pg_dump -U labeling_harness -d labeling_harness --data-only --schema=public --no-owner --no-privileges'); then
    :
  else
    printf 'could not capture isolated database data fingerprint\n' >&2
    return 1
  fi
  schema_fingerprint=$(printf '%s' "$schema_dump" | hash_pg_dump)
  data_fingerprint=$(printf '%s' "$data_dump" | hash_pg_dump)
  combined_fingerprint=$(printf '%s:%s' "$schema_fingerprint" "$data_fingerprint" | node --input-type=module -e '
import {createHash} from "node:crypto";
import {stdin} from "node:process";
const hash = createHash("sha256");
for await (const chunk of stdin) hash.update(chunk);
process.stdout.write(`${hash.digest("hex")}\n`);
')
  printf '%s\n' "$combined_fingerprint"
}

fingerprint_protected_30() {
  node --input-type=module - "$CLEAN_DATABASE_HOST" "$CLEAN_DIR/database-password" \
    "$CLEAN_DIR/validation-study-config.json" "$CLEAN_DIR/validation-study-account-manifest.json" \
    "$CLEAN_DIR/study-profiles.json" <<'NODE'
import {readFileSync} from "node:fs";
import path from "node:path";
import pg from "pg";
import {fingerprintPersistentStudy} from "./test/support/study-state-fingerprint.js";

const [host, passwordFile, configPath, accountManifestPath, profilesPath] = process.argv.slice(2);
const pool = new pg.Pool({
    host,
    port: 5432,
    user: "labeling_harness",
    database: "labeling_harness",
    password: readFileSync(passwordFile, "utf8").trim(),
    max: 1,
    connectionTimeoutMillis: 5000,
});
try {
    const fingerprint = await fingerprintPersistentStudy({
        pool,
        studyKey: "pr-card-sorting-validation-30",
        artifactPaths: [
            path.join(process.cwd(), "plans/validation-30-cards.csv"),
            path.join(process.cwd(), "plans/validation-30-cards.manifest.json"),
            configPath,
            accountManifestPath,
            profilesPath,
        ],
    });
    process.stdout.write(`${fingerprint}\n`);
} finally {
    await pool.end();
}
NODE
}

fingerprint_current_369() {
  node --input-type=module - "$CLEAN_DATABASE_HOST" "$CLEAN_DIR/database-password" \
    "$CLEAN_DIR/study-config.json" "$CLEAN_DIR/study-account-manifest.json" \
    "$CLEAN_DIR/study-profiles.json" <<'NODE'
import {readFileSync} from "node:fs";
import path from "node:path";
import pg from "pg";
import {fingerprintPersistentStudy} from "./test/support/study-state-fingerprint.js";

const [host, passwordFile, configPath, accountManifestPath, profilesPath] = process.argv.slice(2);
const pool = new pg.Pool({
    host,
    port: 5432,
    user: "labeling_harness",
    database: "labeling_harness",
    password: readFileSync(passwordFile, "utf8").trim(),
    max: 1,
    connectionTimeoutMillis: 5000,
});
try {
    const fingerprint = await fingerprintPersistentStudy({
        pool,
        studyKey: "pr-card-sorting-local",
        artifactPaths: [
            path.join(process.cwd(), "plans/copilot-369-cards.csv"),
            path.join(process.cwd(), "plans/copilot-369-cards.manifest.json"),
            configPath,
            accountManifestPath,
            profilesPath,
        ],
    });
    process.stdout.write(`${fingerprint}\n`);
} finally {
    await pool.end();
}
NODE
}

prepare_private_discard_http_inputs() {
  HTTP_CATEGORY_ID=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" exec -T labeling-database \
    psql -v ON_ERROR_STOP=1 -qAt -U labeling_harness -d labeling_harness -c \
    "INSERT INTO participant_category(study_id, participant_id, raw_name, normalized_name) SELECT study.id, participant.reviewer_id, 'Harness private HTTP', 'harness private http' FROM study JOIN study_participant participant ON participant.study_id=study.id WHERE study.study_key='pr-card-sorting-local' AND participant.participant_key='javier' RETURNING id")
  STUDY_HTTP_REPLAY_CARD_ID=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" exec -T labeling-database \
    psql -v ON_ERROR_STOP=1 -qAt -U labeling_harness -d labeling_harness -c \
    "SELECT card.pr_card_id FROM study JOIN study_participant participant ON participant.study_id=study.id JOIN study_card card ON card.study_id=study.id WHERE study.study_key='pr-card-sorting-local' AND participant.participant_key='javier' ORDER BY card.ordinal OFFSET 3 LIMIT 1")
  STUDY_HTTP_NAVIGATION_CARD_ID=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" exec -T labeling-database \
    psql -v ON_ERROR_STOP=1 -qAt -U labeling_harness -d labeling_harness -c \
    "SELECT card.pr_card_id FROM study JOIN study_participant participant ON participant.study_id=study.id JOIN study_card card ON card.study_id=study.id WHERE study.study_key='pr-card-sorting-local' AND participant.participant_key='javier' ORDER BY card.ordinal OFFSET 4 LIMIT 1")
  STUDY_HTTP_CONCURRENT_CARD_ID=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" exec -T labeling-database \
    psql -v ON_ERROR_STOP=1 -qAt -U labeling_harness -d labeling_harness -c \
    "SELECT card.pr_card_id FROM study JOIN study_participant participant ON participant.study_id=study.id JOIN study_card card ON card.study_id=study.id WHERE study.study_key='pr-card-sorting-local' AND participant.participant_key='javier' ORDER BY card.ordinal OFFSET 5 LIMIT 1")
  node --input-type=module - "$STUDY_HTTP_REPLAY_CARD_ID" "$STUDY_HTTP_NAVIGATION_CARD_ID" "$STUDY_HTTP_CONCURRENT_CARD_ID" <<'NODE'
const cardIds = process.argv.slice(2);
if (cardIds.some(cardId => !cardId) || new Set(cardIds).size !== 3) {
    throw new Error("private discard fixture cards must be three distinct study-bound reservations");
}
NODE
  node --input-type=module - "$CLEAN_HTTPS_PORT" "$CLEAN_DIR/multi-study-e2e-credentials.json" \
    "$CLEAN_DIR/integration.env" "$HTTP_CATEGORY_ID" "$STUDY_HTTP_REPLAY_CARD_ID" \
    "$STUDY_HTTP_NAVIGATION_CARD_ID" "$STUDY_HTTP_CONCURRENT_CARD_ID" <<'NODE'
import https from "node:https";
import {readFileSync, writeFileSync} from "node:fs";

const [portText, credentialsPath, outputPath, categoryId, replayCardId, navigationCardId, concurrentCardId] = process.argv.slice(2);
const port = Number(portText);
const origin = `https://localhost:${port}`;
const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
const cookies = new Map();
const cookieHeader = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
const absorbCookies = headers => {
    for (const value of headers["set-cookie"] ?? []) {
        const [pair] = value.split(";", 1);
        const separator = pair.indexOf("=");
        const name = pair.slice(0, separator);
        const content = pair.slice(separator + 1);
        if (content === "") cookies.delete(name);
        else cookies.set(name, content);
    }
};
const request = (pathname, {method = "GET", headers = {}, body = ""} = {}) => new Promise((resolve, reject) => {
    const outgoing = https.request({
        hostname: "127.0.0.1",
        port,
        servername: "localhost",
        method,
        path: pathname,
        rejectUnauthorized: false,
        headers: {host: "localhost", cookie: cookieHeader(), ...headers},
    }, response => {
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => {
            absorbCookies(response.headers);
            resolve({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8")});
        });
    });
    outgoing.on("error", () => reject(new Error("synthetic private-discard HTTPS request failed")));
    outgoing.end(body);
});
const csrfToken = html => {
    const match = html.match(/<input\b[^>]*\bname=(?:["']csrf_token["']|csrf_token)\b[^>]*\bvalue=(?:["']([^"']+)["']|([^\s>]+))/i);
    if (!match) throw new Error("synthetic participant form omitted its CSRF token");
    return match[1] || match[2];
};

try {
    const password = credentials.javier;
    if (typeof password !== "string" || !password) throw new Error("synthetic participant credential is unavailable");
    const loginPage = await request("/login");
    if (loginPage.status !== 200) throw new Error("synthetic participant login page is unavailable");
    const token = csrfToken(loginPage.body);
    const login = await request("/login", {
        method: "POST",
        headers: {origin, "content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({username: "javier", password, csrf_token: token}).toString(),
    });
    if (login.status !== 302 || !cookies.has("__Host-session")) throw new Error("synthetic private-discard account did not authenticate");
    const queue = await request("/queue");
    if (queue.status !== 303 || !/^\/queue\/[0-9a-f-]{36}$/i.test(queue.headers.location ?? "")) {
        throw new Error("synthetic private-discard account has no pending card");
    }
    const card = await request(queue.headers.location);
    if (card.status !== 200) throw new Error("synthetic private-discard card is unavailable");
    const assignments = {
        STUDY_HTTP_BASE_URL: origin,
        STUDY_HTTP_SESSION_COOKIE: `__Host-session=${cookies.get("__Host-session")}`,
        STUDY_HTTP_CSRF_TOKEN: csrfToken(card.body),
        STUDY_HTTP_REPLAY_CARD_ID: replayCardId,
        STUDY_HTTP_NAVIGATION_CARD_ID: navigationCardId,
        STUDY_HTTP_CONCURRENT_CARD_ID: concurrentCardId,
        STUDY_HTTP_CATEGORY_ID: categoryId,
    };
    writeFileSync(outputPath, `${Object.entries(assignments).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, {mode: 0o400});
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "synthetic private-discard session setup failed"}\n`);
    process.exitCode = 1;
}
NODE
}

wait_database_initialization() {
  project=$1
  runtime=$2
  extra=${3:-}
  if [ -n "$extra" ]; then
    if init_output=$(compose_for "$project" "$runtime" -f "$extra" logs --no-color labeling-database 2>&1); then
      :
    else
      printf 'database initialization logs are unavailable for %s\n' "$project" >&2
      return 1
    fi
  else
    if init_output=$(compose_for "$project" "$runtime" logs --no-color labeling-database 2>&1); then
      :
    else
      printf 'database initialization logs are unavailable for %s\n' "$project" >&2
      return 1
    fi
  fi
  case "$init_output" in
    *"PostgreSQL init process complete"*) ;;
    *) printf 'database initialization log marker is missing for %s\n' "$project" >&2; return 1 ;;
  esac
}

SNAPSHOT_SQL="WITH target_study AS (SELECT id, bootstrap_state, source_checksum FROM study WHERE study_key='pr-card-sorting-local') SELECT json_build_object('state',(SELECT bootstrap_state FROM target_study),'cards',(SELECT COUNT(*) FROM study_card WHERE study_id=(SELECT id FROM target_study)),'members',(SELECT COUNT(*) FROM study_participant WHERE study_id=(SELECT id FROM target_study)),'accounts',(SELECT COUNT(*) FROM participant_account WHERE study_id=(SELECT id FROM target_study)),'account_digest',(SELECT md5(string_agg(normalized_username || ':' || credential_version || ':' || md5(password_hash),',' ORDER BY normalized_username)) FROM participant_account WHERE study_id=(SELECT id FROM target_study)),'card_digest',(SELECT md5(string_agg(source_card_id || ':' || source_checksum,',' ORDER BY ordinal)) FROM study_card WHERE study_id=(SELECT id FROM target_study)),'classifications',(SELECT COUNT(*) FROM pr_classification WHERE study_id=(SELECT id FROM target_study)),'classification_digest',(SELECT md5(string_agg(pr_card_id::text || ':' || participant_id || ':' || remarks,',' ORDER BY pr_card_id,participant_id)) FROM pr_classification WHERE study_id=(SELECT id FROM target_study)),'source_checksum',(SELECT source_checksum FROM target_study));"
DUAL_SQL="SELECT json_agg(row_to_json(profile) ORDER BY profile.expected_card_count DESC) FROM (SELECT study_key, expected_card_count, bootstrap_state, (SELECT COUNT(*) FROM study_participant WHERE study_id=study.id) AS participants, (SELECT COUNT(*) FROM study_card WHERE study_id=study.id) AS cards, (SELECT COUNT(*) FROM participant_account WHERE study_id=study.id) AS accounts FROM study) profile;"
SEED_SQL="WITH target AS (SELECT study.id AS study_id, participant.reviewer_id, card.pr_card_id FROM study JOIN study_participant participant ON participant.study_id=study.id JOIN study_card card ON card.study_id=study.id WHERE study.study_key='pr-card-sorting-local' AND participant.ordinal=0 AND card.ordinal=0), category AS (INSERT INTO participant_category(study_id,participant_id,raw_name,normalized_name) SELECT study_id,reviewer_id,'Harness preserved','harness preserved' FROM target RETURNING id,study_id,participant_id) INSERT INTO pr_classification(pr_card_id,participant_id,category_id,remarks,study_id) SELECT target.pr_card_id,target.reviewer_id,category.id,'preserve-across-restart',target.study_id FROM target JOIN category ON category.study_id=target.study_id;"
LEGACY_SEED_SQL="BEGIN; INSERT INTO instance(category,data) VALUES ('legacy-harness','{\"fixture\":\"deployment-harness\"}'); INSERT INTO label(name) VALUES ('legacy-harness-label'); INSERT INTO instance_review_conflict_resolution(instance_id,conflict) SELECT id,'1'::conflict FROM instance WHERE category='legacy-harness'; COMMIT;"

assert_runtime_ports() {
  project=$1
  runtime=$2
  http_port=$3
  https_port=$4
  extra=${5:-}
  if [ -n "$extra" ]; then
    compose_for "$project" "$runtime" -f "$extra" ps --format json > "$runtime/ps.json"
  else
    compose_for "$project" "$runtime" ps --format json > "$runtime/ps.json"
  fi
  node --input-type=module - "$runtime/ps.json" "$http_port" "$https_port" <<'NODE'
import {readFileSync} from "node:fs";
const content = readFileSync(process.argv[2], "utf8").trim();
const [httpPort, httpsPort] = process.argv.slice(3);
const rows = content.startsWith("[") ? JSON.parse(content) : content.split("\n").map(line => JSON.parse(line));
for (const row of rows) {
    const publishers = (row.Publishers ?? []).filter(port => port.PublishedPort > 0);
    const allowedTargets = row.Service === "labeling-caddy" ? [80, 443] : [];
    if (publishers.some(port => port.URL !== "127.0.0.1" || !allowedTargets.includes(port.TargetPort))) {
        throw new Error("unexpected runtime publisher");
    }
    if (row.Service === "labeling-caddy") {
        const actual = publishers.map(port => `${port.PublishedPort}:${port.TargetPort}`).sort();
        const expected = [`${httpPort}:80`, `${httpsPort}:443`].sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Caddy port bindings differ from the unique loopback allocation");
    }
    if (row.Service !== "labeling-caddy" && publishers.length > 0) {
        throw new Error(`${row.Service} is host-published`);
    }
}
NODE
  status=$(curl --silent --show-error --insecure --noproxy '*' --resolve "localhost:$https_port:127.0.0.1" \
    --output /dev/null --write-out '%{http_code}' "https://localhost:$https_port/login")
  [ "$status" = "200" ] || { printf 'Caddy login check returned %s\n' "$status" >&2; return 1; }
  for path in /actuator /actuator/health /actuator/private/child; do
    status=$(curl --silent --show-error --insecure --noproxy '*' --resolve "localhost:$https_port:127.0.0.1" \
      --output /dev/null --write-out '%{http_code}' "https://localhost:$https_port$path")
    [ "$status" = "404" ] || { printf 'Caddy %s check returned %s\n' "$path" "$status" >&2; return 1; }
  done
}

if [ "$LEGACY_ONLY" = false ]; then
write_runtime "$CLEAN_DIR" "$CLEAN_PROJECT" clean "$CLEAN_HTTP_PORT" "$CLEAN_HTTPS_PORT"
chmod 0600 "$CLEAN_DIR/harness.yml"
verify_config "$CLEAN_PROJECT" "$CLEAN_DIR" "$CLEAN_HTTP_PORT" "$CLEAN_HTTPS_PORT" clean
printf '%s\n' "$CLEAN_PROJECT-database-fixture:latest" > "$WORK_DIR/$CLEAN_PROJECT.image-reference"
docker build --tag "$CLEAN_PROJECT-database-fixture:latest" --file "$ROOT/deployment/database/Dockerfile" "$ROOT"
compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" up --no-build --wait --wait-timeout 240 labeling-database
wait_database_initialization "$CLEAN_PROJECT" "$CLEAN_DIR"
CLEAN_DATABASE_HOST=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${CLEAN_PROJECT}-database")
[ -n "$CLEAN_DATABASE_HOST" ] || { printf 'isolated clean database IP is unavailable\n' >&2; exit 1; }
prepare_empty_origin "$CLEAN_DATABASE_HOST" "$CLEAN_DIR" "$CLEAN_PROJECT"
start_locked_handoff "$CLEAN_DIR" "$CLEAN_PROJECT"
write_handoff_overlay "$CLEAN_DIR"
verify_config "$CLEAN_PROJECT" "$CLEAN_DIR" "$CLEAN_HTTP_PORT" "$CLEAN_HTTPS_PORT" clean \
  "$CLEAN_DIR/handoff.yml" true

printf 'STAGE_UNTRUSTED_CONTEXT_REJECTIONS_BEGIN\n'
absent_context=
if absent_context=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" run --rm --no-deps \
  -e LABELER_RELEASE_CONTEXT= labeling-study-prepare 2>&1); then
  absent_context_status=0
else
  absent_context_status=$?
fi
report_prepare_probe_diagnostic absent-context "$absent_context_status" "$absent_context"
if [ "$absent_context_status" -eq 0 ]; then
  printf 'standalone empty-database preparation unexpectedly passed\n' >&2
  exit 1
else
  case "$absent_context" in
    *"Initialization requires the locked host's root-owned pending handoff"*) ;;
    *) printf 'standalone preparation failed for an unexpected reason\n' >&2; exit 1 ;;
  esac
fi
forged_context=
if forged_context=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" run --rm --no-deps \
  -e LABELER_RELEASE_CONTEXT=/run/labeler-release/forged.json labeling-study-prepare 2>&1); then
  forged_context_status=0
else
  forged_context_status=$?
fi
report_prepare_probe_diagnostic forged-context "$forged_context_status" "$forged_context"
if [ "$forged_context_status" -eq 0 ]; then
  printf 'forged release context path unexpectedly passed\n' >&2
  exit 1
else
  case "$forged_context" in
    *"Untrusted release context path."*) ;;
    *) printf 'forged context failed for an unexpected reason\n' >&2; exit 1 ;;
  esac
fi
verify_clean_origin_unchanged "$CLEAN_DATABASE_HOST" "$CLEAN_DIR"
printf 'STAGE_UNTRUSTED_CONTEXT_REJECTIONS_OK\n'

printf 'STAGE_LOCKED_ROOT_HANDOFF_PREPARE_BEGIN\n'
PREPARE_OUTPUT=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" -f "$CLEAN_DIR/handoff.yml" \
  run --rm --no-deps labeling-study-prepare)
case "$PREPARE_OUTPUT" in
  *"Study pr-card-sorting-local is READY"*"Study pr-card-sorting-validation-30 is READY"*) ;;
  *) printf 'prepare log did not report both ordered READY profiles\n' >&2; exit 1 ;;
esac
lock_probe=$(docker exec "$HANDOFF_CONTAINER_NAME" python3 -B \
  /workspace/test/support/locked-prepare-handoff.py --probe)
[ "$lock_probe" = "LOCK_HELD" ] || { printf 'prepare lock was released before prepare completed\n' >&2; exit 1; }
HANDOFF_LOCK_HELD_THROUGH_PREPARE=true
stop_handoff_owner
rm "$CLEAN_DIR/handoff.yml"
printf 'STAGE_LOCKED_ROOT_HANDOFF_PREPARE_OK\n'
printf 'STAGE_ROOT_HANDOFF_CLEANUP_OK\n'
if [ -n "$EVIDENCE_DIR" ]; then
  printf 'Study pr-card-sorting-local is READY\nStudy pr-card-sorting-validation-30 is READY\nordered_profiles=369,30\n' \
    > "$EVIDENCE_DIR/prepare.log"
  cp "$WORK_DIR/$CLEAN_PROJECT-handoff-binding.json" "$EVIDENCE_DIR/prepare-handoff-binding.json"
fi
DUAL_STATE=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" exec -T labeling-database psql -U labeling_harness -d labeling_harness -At -c "$DUAL_SQL")
node --input-type=module - "$DUAL_STATE" <<'NODE'
const profiles = JSON.parse(process.argv[2]);
const expected = [
    {study_key: "pr-card-sorting-local", expected_card_count: 369, bootstrap_state: "READY", participants: 3, cards: 369, accounts: 3},
    {study_key: "pr-card-sorting-validation-30", expected_card_count: 30, bootstrap_state: "READY", participants: 3, cards: 30, accounts: 3},
];
if (JSON.stringify(profiles) !== JSON.stringify(expected)) throw new Error("dual-profile database state is invalid");
NODE
node "$ROOT/test/support/normalization-harness-db.js" clean "$CLEAN_DATABASE_HOST" "$CLEAN_DIR" \
  "$CLEAN_PROJECT" "$CLEAN_DIR/clean-014-initial.json"
if [ -n "$EVIDENCE_DIR" ]; then
  cp "$CLEAN_DIR/clean-014-initial.json" "$EVIDENCE_DIR/clean-014-initial.json"
fi
printf 'STAGE_CANONICAL_014_NO_015_INITIAL_OK\n'
  compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" up --no-build --no-deps --wait --wait-timeout 180 labeling-server
  compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" up --no-build --no-deps --wait --wait-timeout 180 labeling-caddy
CLEAN_RUNNING_IMAGE=$(docker inspect --format '{{.Image}}' "${CLEAN_PROJECT}-server")
[ "$CLEAN_RUNNING_IMAGE" = "$CLEAN_SERVER_IMAGE" ] || { printf 'runtime server differs from the selected fixture image\n' >&2; exit 1; }
assert_runtime_ports "$CLEAN_PROJECT" "$CLEAN_DIR" "$CLEAN_HTTP_PORT" "$CLEAN_HTTPS_PORT"
prepare_private_discard_http_inputs
printf 'STAGE_PRIVATE_DISCARD_HTTP_BEGIN\n'
(
  set -a
  . "$CLEAN_DIR/integration.env"
  set +a
  NODE_TLS_REJECT_UNAUTHORIZED=0 node --test --test-concurrency=1 "$ROOT/test/private-discard-http.test.js"
)
printf 'STAGE_PRIVATE_DISCARD_HTTP_OK\n'

MULTI_STUDY_E2E_LOG="$CLEAN_DIR/multi-study-hostile-e2e.log"
unset NODE_TEST_CONTEXT
printf 'STAGE_MULTI_STUDY_HOSTILE_E2E_BEGIN\n'
if env \
  STUDY_MULTI_STUDY_E2E_ISOLATED_RUNTIME=true \
  STUDY_MULTI_STUDY_E2E_BASE_URL="https://127.0.0.1:$CLEAN_HTTPS_PORT" \
  STUDY_MULTI_STUDY_E2E_VIRTUAL_HOST=localhost \
  STUDY_MULTI_STUDY_E2E_CREDENTIALS_FILE="$CLEAN_DIR/multi-study-e2e-credentials.json" \
  STUDY_MULTI_STUDY_E2E_DATABASE_HOST="$CLEAN_DATABASE_HOST" \
  STUDY_MULTI_STUDY_E2E_DATABASE_PORT=5432 \
  STUDY_MULTI_STUDY_E2E_DATABASE_USER=labeling_harness \
  STUDY_MULTI_STUDY_E2E_DATABASE_NAME=labeling_harness \
  STUDY_MULTI_STUDY_E2E_DATABASE_PASS_FILE="$CLEAN_DIR/database-password" \
  node --test --test-concurrency=1 "$ROOT/test/multi-study-hostile-e2e.integration.js" > "$MULTI_STUDY_E2E_LOG" 2>&1; then
  :
else
  if [ -n "$EVIDENCE_DIR" ]; then
    cp "$MULTI_STUDY_E2E_LOG" "$EVIDENCE_DIR/multi-study-hostile-e2e.log"
  fi
  printf 'MULTI_STUDY_HOSTILE_E2E_FAILED project=%s sanitized_evidence=%s\n' \
    "$CLEAN_PROJECT" "${EVIDENCE_DIR:-unavailable}" >&2
  exit 1
fi
if [ -n "$EVIDENCE_DIR" ]; then
  cp "$MULTI_STUDY_E2E_LOG" "$EVIDENCE_DIR/multi-study-hostile-e2e.log"
  printf 'hostile_e2e=passed\nsnapshot_export_cards=369\nsnapshot_export_participants=2\nsnapshot_export_columns=8\nfollowup_export_cards=369\nfollowup_export_participants=3\nfollowup_export_columns=11\nvalidation_export_cards=30\ncredentials_outside_repository=true\ndatabase_host_port_published=false\n' \
    > "$EVIDENCE_DIR/multi-study-hostile-e2e.txt"
fi
printf 'MULTI_STUDY_HOSTILE_E2E_OK project=%s\n' "$CLEAN_PROJECT"
printf 'STAGE_MULTI_STUDY_HOSTILE_E2E_OK\n'

printf 'STAGE_INTEGRATION_SUITE_BEGIN\n'
LABELER_READINESS_TEST_IMAGE="$CLEAN_SERVER_IMAGE" npm run test:integration
printf 'STAGE_INTEGRATION_SUITE_OK\n'

printf 'STAGE_INTERNAL_RUNTIME_HEALTH_BEGIN\n'
docker run --rm --network "${CLEAN_PROJECT}-network" --read-only --user 1000:1000 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000 \
  --mount "type=bind,src=$ROOT/test,dst=/labeling/test,readonly" \
  --env STUDY_E2E_BASE_URL=http://labeling-server:3000 \
  --env npm_config_cache=/tmp/npm-cache \
  --entrypoint npm "$CLEAN_SERVER_IMAGE" run test:e2e
printf 'STAGE_INTERNAL_RUNTIME_HEALTH_OK\n'

PROTECTED_30_BEFORE=$(fingerprint_protected_30)
PRIMARY_369_BEFORE=$(fingerprint_current_369)
node --input-type=module - "$PROTECTED_30_BEFORE" "$PRIMARY_369_BEFORE" <<'NODE'
if (process.argv.slice(2).some(fingerprint => !/^[a-f0-9]{64}$/.test(fingerprint))) {
    throw new Error("study fingerprint is not SHA-256");
}
NODE
if [ -n "$EVIDENCE_DIR" ]; then
  printf '%s\n' "$PROTECTED_30_BEFORE" > "$EVIDENCE_DIR/protected-30-before.sha256"
  printf '%s\n' "$PRIMARY_369_BEFORE" > "$EVIDENCE_DIR/primary-369-before.sha256"
  printf 'persistent_tables_fingerprinted=study,reviewer,participant_account,study_participant,study_card,pr_cards,github_card_snapshot,github_enrichment_run,github_run_page,github_enrichment_run_card,study_enrichment_promotion,participant_category,pr_classification,pr_discard,github_api_telemetry_event,labeler_migration\nauth_transients_excluded=app_session,login_csrf_context,login_ip_attempt,participant_account.failed_login_attempts,participant_account.failed_login_window_started_at,participant_account.locked_until\n' \
    > "$EVIDENCE_DIR/protected-30-fingerprint-scope.txt"
fi

compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" stop labeling-server labeling-caddy >/dev/null
CLEAN_014_BEFORE_RERUN="$CLEAN_DIR/clean-014-before-rerun.json"
node "$ROOT/test/support/normalization-harness-db.js" clean "$CLEAN_DATABASE_HOST" "$CLEAN_DIR" \
  "$CLEAN_PROJECT" "$CLEAN_014_BEFORE_RERUN"
  PREPARE_RERUN_OUTPUT=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" run --rm --no-deps labeling-study-prepare)
case "$PREPARE_RERUN_OUTPUT" in
  *"Approved 369+30 studies verified read-only"*) ;;
  *) printf 'successive prepare did not report readonly exact-study verification\n' >&2; exit 1 ;;
esac
PROTECTED_30_AFTER=$(fingerprint_protected_30)
[ "$PROTECTED_30_AFTER" = "$PROTECTED_30_BEFORE" ] || { printf 'successive prepare changed the protected 30 persistent fingerprint\n' >&2; exit 1; }
PRIMARY_369_AFTER=$(fingerprint_current_369)
CLEAN_014_AFTER_RERUN="$CLEAN_DIR/clean-014-after-rerun.json"
node "$ROOT/test/support/normalization-harness-db.js" clean "$CLEAN_DATABASE_HOST" "$CLEAN_DIR" \
  "$CLEAN_PROJECT" "$CLEAN_014_AFTER_RERUN"
node --input-type=module - "$CLEAN_014_BEFORE_RERUN" "$CLEAN_014_AFTER_RERUN" <<'NODE'
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const [beforePath, afterPath] = process.argv.slice(2);
const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));
assert.equal(before.probe.applied015, false);
assert.equal(after.probe.applied015, false);
assert.equal(before.probe.eligibility, "eligible");
assert.equal(after.probe.eligibility, "eligible");
assert.equal(before.applicationRowsSha256, after.applicationRowsSha256);
for (const key of ["schema", "dataBundle", "fingerprint", "schemaFingerprint", "databaseIdentity"]) {
    assert.deepEqual(after.probe.observation[key], before.probe.observation[key]);
}
NODE
[ "$PRIMARY_369_AFTER" = "$PRIMARY_369_BEFORE" ] || { printf 'successive prepare changed primary 369 persistent state\n' >&2; exit 1; }
if [ -n "$EVIDENCE_DIR" ]; then
  printf '%s\n' "$PROTECTED_30_AFTER" > "$EVIDENCE_DIR/protected-30-after.sha256"
  printf '%s\n' "$PRIMARY_369_AFTER" > "$EVIDENCE_DIR/primary-369-after.sha256"
  cp "$CLEAN_014_BEFORE_RERUN" "$EVIDENCE_DIR/clean-014-before-rerun.json"
  cp "$CLEAN_014_AFTER_RERUN" "$EVIDENCE_DIR/clean-014-after-rerun.json"
  printf 'successive_prepare=readonly_exact_pair\nprotected_30_fingerprint_equal=true\nprimary_369_fingerprint_equal=true\n' \
    > "$EVIDENCE_DIR/successive-release.txt"
fi
printf 'PROTECTED_30_PRESERVED fingerprint=%s\n' "$PROTECTED_30_AFTER"
printf 'PRIMARY_369_PRESERVED fingerprint=%s\n' "$PRIMARY_369_AFTER"
printf 'STAGE_CANONICAL_014_NO_015_OK\n'
printf 'STAGE_SUCCESSIVE_READONLY_PRESERVATION_OK\n'
  compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" up --no-build --no-deps --wait --wait-timeout 180 labeling-server
  compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" up --no-build --no-deps --wait --wait-timeout 180 labeling-caddy
assert_runtime_ports "$CLEAN_PROJECT" "$CLEAN_DIR" "$CLEAN_HTTP_PORT" "$CLEAN_HTTPS_PORT"
CLEAN_PRIMARY_BEFORE_DRIFT=$(snapshot "$CLEAN_PROJECT" "$CLEAN_DIR")
compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" stop labeling-server labeling-caddy >/dev/null
compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" exec -T labeling-database psql -v ON_ERROR_STOP=1 -U labeling_harness -d labeling_harness \
  -c "UPDATE study_participant SET participant_key='validation-drift' WHERE study_id=(SELECT id FROM study WHERE study_key='pr-card-sorting-validation-30') AND ordinal=0" >/dev/null
  if compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" up --no-build --wait --wait-timeout 180 >/dev/null 2>&1; then
  printf 'second-profile drift unexpectedly passed\n' >&2
  exit 1
fi
[ "$(snapshot "$CLEAN_PROJECT" "$CLEAN_DIR")" = "$CLEAN_PRIMARY_BEFORE_DRIFT" ] || { printf 'second-profile drift changed the primary 369 study\n' >&2; exit 1; }
RUNNING_SERVICES=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" ps --services --status running)
case "$RUNNING_SERVICES" in
  *labeling-server*|*labeling-caddy*) printf 'public services ran after failed second profile\n' >&2; exit 1 ;;
esac
if curl --max-time 2 --silent --show-error --insecure --noproxy '*' --resolve "localhost:$CLEAN_HTTPS_PORT:127.0.0.1" \
  "https://localhost:$CLEAN_HTTPS_PORT/login" >/dev/null 2>&1; then
  printf 'public readiness remained reachable after failed second profile\n' >&2
  exit 1
fi
if [ -n "$EVIDENCE_DIR" ]; then
  printf 'second_profile_drift_rejected=true\nprimary_369_fingerprint_unchanged=true\nserver_running=false\ncaddy_running=false\npublic_readiness_reachable=false\n' \
    > "$EVIDENCE_DIR/failure.log"
fi
printf 'DUAL_PROFILE_OK state=%s primary_fingerprint_preserved=true idempotent=true failure_gated=true\n' "$DUAL_STATE"
fi

write_runtime "$EXISTING_DIR" "$EXISTING_PROJECT" existing "$EXISTING_HTTP_PORT" "$EXISTING_HTTPS_PORT"
write_existing_inputs "$EXISTING_DIR" "$EXISTING_PROJECT"
verify_config "$EXISTING_PROJECT" "$EXISTING_DIR" "$EXISTING_HTTP_PORT" "$EXISTING_HTTPS_PORT" existing "$ROOT/deployment/docker-compose.existing.yml"
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" up -d --wait --wait-timeout 180 labeling-database
wait_database_initialization "$EXISTING_PROJECT" "$EXISTING_DIR" "$ROOT/deployment/docker-compose.existing.yml"
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" exec -T labeling-database \
  psql -v ON_ERROR_STOP=1 -U labeling_harness -d labeling_harness -c "$LEGACY_SEED_SQL" >/dev/null
LEGACY_BEFORE=$(database_schema_data_fingerprint "$EXISTING_PROJECT")
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" exec -T labeling-database \
  pg_dump -U labeling_harness -d labeling_harness --format=custom --data-only \
  --table=public.instance --table=public.label --table=public.instance_review --table=public.instance_discard \
  --table=public.instance_review_label --table=public.instance_review_conflict_resolution > "$EXISTING_DIR/backup/legacy.dump"
node --input-type=module - "$EXISTING_DIR/backup/legacy.dump" "$EXISTING_DIR/backup/legacy.manifest.json" "$ROOT/schema/migrations/legacy-labeler-inventory.json" <<'NODE'
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
const [archivePath, manifestPath, inventoryPath] = process.argv.slice(2);
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
writeFileSync(manifestPath, `${JSON.stringify({
    manifestVersion: 1,
    archiveFile: path.basename(archivePath),
    archiveSha256: createHash("sha256").update(readFileSync(archivePath)).digest("hex"),
    inventorySha256: inventory.inventorySha256,
    createdAt: new Date().toISOString(),
    format: "custom",
    dataOnly: true,
    database: {host: "labeling-database", port: "5432", database: "labeling_harness", user: "labeling_harness"},
    tables: inventory.inventory.backup.tables,
})}\n`);
NODE
cp "$EXISTING_DIR/backup/legacy.dump" "$EXISTING_DIR/backup/legacy.valid.dump"
chmod 0400 "$EXISTING_DIR/backup/legacy.dump" "$EXISTING_DIR/backup/legacy.valid.dump" "$EXISTING_DIR/backup/legacy.manifest.json"
stage_node_container_inputs "$EXISTING_DIR" backup/legacy.dump backup/legacy.manifest.json

printf 'STAGE_ORDINARY_EXISTING_REJECTION_BEGIN\n'
if ordinary_prepare_output=$(compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  up --no-build --wait --wait-timeout 180 2>&1); then
  printf 'ordinary existing preparation unexpectedly retired a legacy database\n' >&2
  exit 1
fi
ordinary_prepare_log=$(compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  logs --no-color labeling-study-prepare 2>&1)
case "$ordinary_prepare_output $ordinary_prepare_log" in
  *"Unexpected legacy or unknown database objects."*) ;;
  *) printf 'ordinary existing preparation failed without the expected legacy guard\n' >&2; exit 1 ;;
esac
RUNNING_EXISTING_SERVICES=$(compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  ps --services --status running)
case "$RUNNING_EXISTING_SERVICES" in
  *labeling-server*|*labeling-caddy*) printf 'ordinary legacy rejection started the server or Caddy\n' >&2; exit 1 ;;
esac
PRE_RETIREMENT_STATE=$(compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  exec -T labeling-database psql -U labeling_harness -d labeling_harness -At -c \
  "SELECT to_regclass('public.labeler_migration') IS NULL AND NOT EXISTS (SELECT FROM public.study)")
[ "$PRE_RETIREMENT_STATE" = "t" ] || { printf 'ordinary legacy rejection wrote migrations or study rows\n' >&2; exit 1; }
LEGACY_AFTER_REJECTION=$(database_schema_data_fingerprint "$EXISTING_PROJECT")
if [ -n "$EVIDENCE_DIR" ]; then
  printf '%s\n' "$LEGACY_BEFORE" > "$EVIDENCE_DIR/legacy-before-rejection.sha256"
  printf '%s\n' "$LEGACY_AFTER_REJECTION" > "$EVIDENCE_DIR/legacy-after-rejection.sha256"
fi
[ "$LEGACY_AFTER_REJECTION" = "$LEGACY_BEFORE" ] || {
  printf 'ordinary legacy rejection changed schema, data, or migration ledger: before=%s after=%s\n' \
    "$LEGACY_BEFORE" "$LEGACY_AFTER_REJECTION" >&2
  exit 1
}
if [ -n "$EVIDENCE_DIR" ]; then
  printf 'ordinary_existing_prepare=Unexpected legacy or unknown database objects.\nserver_running=false\ncaddy_running=false\nledger_unchanged=true\nschema_data_fingerprint_equal=true\n' \
    > "$EVIDENCE_DIR/ordinary-legacy-rejection.txt"
fi
printf 'STAGE_ORDINARY_EXISTING_REJECTION_OK\n'

printf 'STAGE_GUARDED_LEGACY_RETIREMENT_BEGIN\n'
RETIREMENT_SEQUENCE_OUTPUT=$(compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  run --rm --no-deps --entrypoint sh labeling-study-prepare -c \
  'npm run migrate:study -- --through 001_study_foundation && npm run retire:legacy:apply && npm run migrate:study')
case "$RETIREMENT_SEQUENCE_OUTPUT" in
  *"Applied migration 002_retire_legacy_labeler"*"Study schema migration complete"*) ;;
  *) printf 'guarded existing sequence did not apply retirement and finish migrations\n' >&2; exit 1 ;;
esac
EXISTING_BEFORE_IDEMPOTENT_RETIREMENT=$(database_schema_data_fingerprint "$EXISTING_PROJECT")
EXPLICIT_RETIREMENT_OUTPUT=$(compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  run --rm --no-deps --entrypoint sh labeling-study-prepare -c 'npm run retire:legacy:apply')
case "$EXPLICIT_RETIREMENT_OUTPUT" in
  *"database state: already-retired"*) ;;
  *) printf 'valid-backup retirement CLI rerun did not report already-retired\n' >&2; exit 1 ;;
esac
case "$EXPLICIT_RETIREMENT_OUTPUT" in
  *"Applied migration 002_retire_legacy_labeler"*) printf 'idempotent retirement reapplied migration 002\n' >&2; exit 1 ;;
esac
EXISTING_AFTER_IDEMPOTENT_RETIREMENT=$(database_schema_data_fingerprint "$EXISTING_PROJECT")
[ "$EXISTING_AFTER_IDEMPOTENT_RETIREMENT" = "$EXISTING_BEFORE_IDEMPOTENT_RETIREMENT" ] \
  || { printf 'already-retired CLI changed schema, data, or migration ledger\n' >&2; exit 1; }
LEGACY_STATUS=$(compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" exec -T labeling-database \
  psql -U labeling_harness -d labeling_harness -At -c "SELECT
    EXISTS (SELECT FROM labeler_migration WHERE migration_id='002_retire_legacy_labeler')
    AND to_regclass('public.reviewer') IS NOT NULL AND to_regclass('public.pr_cards') IS NOT NULL
    AND to_regclass('public.study') IS NOT NULL AND to_regclass('public.study_participant') IS NOT NULL
    AND to_regclass('public.study_card') IS NOT NULL AND to_regclass('public.participant_category') IS NOT NULL
    AND to_regclass('public.pr_classification') IS NOT NULL" | tr -d '[:space:]')
[ "$LEGACY_STATUS" = "t" ] || { printf 'retired inventory, 002 ledger, or protected objects are invalid\n' >&2; exit 1; }
EXISTING_DATABASE_HOST=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${EXISTING_PROJECT}-database")
if [ -n "$EVIDENCE_DIR" ]; then
  printf '%s\n' "$LEGACY_STATUS" > "$EVIDENCE_DIR/retired-inventory-and-protected-objects.txt"
  printf '%s\n' "$EXISTING_BEFORE_IDEMPOTENT_RETIREMENT" > "$EVIDENCE_DIR/retired-before-idempotent-apply.sha256"
  printf '%s\n' "$EXISTING_AFTER_IDEMPOTENT_RETIREMENT" > "$EVIDENCE_DIR/retired-after-idempotent-apply.sha256"
  printf 'already_retired_with_valid_backup=true\nledger_002_present=true\nprotected_objects_present=true\n' \
    > "$EVIDENCE_DIR/guarded-legacy-retirement.txt"
fi
printf 'STAGE_GUARDED_LEGACY_RETIREMENT_OK\n'

EXISTING_BEFORE_CORRUPT_BACKUP=$(database_schema_data_fingerprint "$EXISTING_PROJECT")
chmod 0600 "$EXISTING_DIR/backup/legacy.dump"
printf 'corrupt' >> "$EXISTING_DIR/backup/legacy.dump"
chmod 0400 "$EXISTING_DIR/backup/legacy.dump"
stage_node_container_inputs "$EXISTING_DIR" backup/legacy.dump backup/legacy.manifest.json
printf 'STAGE_CORRUPT_BACKUP_REJECTION_BEGIN\n'
if corrupt_backup_output=$(compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  run --rm --no-deps --entrypoint sh labeling-study-prepare -c 'npm run retire:legacy:apply' 2>&1); then
  printf 'corrupt backup passed the explicit retirement CLI\n' >&2
  exit 1
else
  case "$corrupt_backup_output" in
    *"Backup archive checksum mismatch"*) ;;
    *) printf 'corrupt backup failed for an unexpected reason\n' >&2; exit 1 ;;
  esac
fi
AFTER_CORRUPT_BACKUP=$(database_schema_data_fingerprint "$EXISTING_PROJECT")
[ "$AFTER_CORRUPT_BACKUP" = "$EXISTING_BEFORE_CORRUPT_BACKUP" ] || { printf 'corrupt backup changed the retired database\n' >&2; exit 1; }
chmod 0600 "$EXISTING_DIR/backup/legacy.dump"
cp "$EXISTING_DIR/backup/legacy.valid.dump" "$EXISTING_DIR/backup/legacy.dump"
chmod 0400 "$EXISTING_DIR/backup/legacy.dump"
stage_node_container_inputs "$EXISTING_DIR" backup/legacy.dump backup/legacy.manifest.json
RESTORED_RETIREMENT_OUTPUT=$(compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  run --rm --no-deps --entrypoint sh labeling-study-prepare -c 'npm run retire:legacy:apply')
case "$RESTORED_RETIREMENT_OUTPUT" in
  *"database state: already-retired"*) ;;
  *) printf 'restored task-owned backup did not pass guarded idempotent verification\n' >&2; exit 1 ;;
esac
if [ -n "$EVIDENCE_DIR" ]; then
  printf '%s\n' "$EXISTING_BEFORE_CORRUPT_BACKUP" > "$EVIDENCE_DIR/retired-before-corrupt-backup.sha256"
  printf '%s\n' "$AFTER_CORRUPT_BACKUP" > "$EVIDENCE_DIR/retired-after-corrupt-backup.sha256"
  printf 'corrupt_backup_rejected_before_mutation=true\nfixture_backup_restored=true\n' \
    > "$EVIDENCE_DIR/corrupt-backup-rejection.txt"
fi
printf 'STAGE_CORRUPT_BACKUP_REJECTION_OK\n'

printf 'STAGE_POST_RETIREMENT_INITIALIZATION_BEGIN\n'
EXISTING_DATABASE_HOST=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${EXISTING_PROJECT}-database")
[ -n "$EXISTING_DATABASE_HOST" ] || { printf 'isolated existing database IP is unavailable\n' >&2; exit 1; }
REFERENCE_DATABASE="${RUN_ID}_managed_reference"
node --input-type=module - "$EXISTING_DATABASE_HOST" "$EXISTING_DIR/database-password" "$REFERENCE_DATABASE" <<'NODE'
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import pg from "pg";
import {managedMigrations, runStudyMigrations} from "./util/study-schema.js";

const [host, passwordPath, database] = process.argv.slice(2);
assert.match(database, /^[a-z0-9_-]+$/);
const connection = {host, port: 5432, user: "labeling_harness", password: readFileSync(passwordPath, "utf8").trim(), max: 1};
const administrator = new pg.Pool({...connection, database: "labeling_harness"});
try {
    await administrator.query(`CREATE DATABASE "${database}"`);
} finally {
    await administrator.end();
}
const reference = new pg.Pool({...connection, database});
try {
    const applied = await runStudyMigrations(reference);
    assert.deepEqual(applied, managedMigrations.map(migration => migration.id));
} finally {
    await reference.end();
}
NODE
CATALOG_DIFF_PATH="${EVIDENCE_DIR:-$WORK_DIR}/retired-schema-catalog-diff.json"
node "$ROOT/test/support/diagnose-retired-schema.js" "$EXISTING_DATABASE_HOST" \
  "$EXISTING_DIR/database-password" labeling_harness labeling_harness "$REFERENCE_DATABASE" "$CATALOG_DIFF_PATH"
prepare_empty_origin "$EXISTING_DATABASE_HOST" "$EXISTING_DIR" "$EXISTING_PROJECT" normalization
PRE_NORMALIZATION_PROBE="$EXISTING_DIR/host-control/normalization-pre-probe.json"
NORMALIZATION_ROWS_BEFORE=$(node "$ROOT/test/support/normalization-harness-db.js" fingerprint \
  "$EXISTING_DATABASE_HOST" "$EXISTING_DIR" "$EXISTING_PROJECT" -)
if [ -n "$EVIDENCE_DIR" ]; then
  cp "$PRE_NORMALIZATION_PROBE" "$EVIDENCE_DIR/normalization-pre-probe.json"
  printf '%s\n' "$NORMALIZATION_ROWS_BEFORE" > "$EVIDENCE_DIR/normalization-application-rows-before.sha256"
fi
printf 'STAGE_NORMALIZATION_PROBE_OK\n'

write_handoff_overlay "$EXISTING_DIR"
write_retired_mode_overlay "$EXISTING_DIR"
start_locked_handoff "$EXISTING_DIR" "$EXISTING_PROJECT" /workspace/test/support/locked-normalization-handoff.py
verify_config "$EXISTING_PROJECT" "$EXISTING_DIR" "$EXISTING_HTTP_PORT" "$EXISTING_HTTPS_PORT" clean "" true existing-clean
node --input-type=module - "$EXISTING_DIR/host-control/normalization-report.json" <<'NODE'
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const reservation = report.reservation;
assert.equal(reservation.phase, "pending");
assert.equal(reservation.journalStatus, "pending");
assert.equal(reservation.beforeSql, true);
assert.equal(reservation.generationFloor, reservation.candidateGeneration);
assert.equal(report.normalizationProbe.applied015, false);
assert.equal(report.backupRestoreProofs.at(-1).archiveScope, "full-database");
assert.equal(report.backupRestoreProofs.at(-1).restoreResult, "verified");
assert.equal(report.backupRestoreProofs.at(-1).syntheticFixture, true);
assert.equal(report.backupRestoreProofs.at(-1).hostBoundaryAccepted, true);
NODE
printf 'STAGE_NORMALIZATION_PENDING_BEFORE_SQL_OK\n'

printf 'STAGE_NORMALIZATION_SQL_BEGIN\n'
NORMALIZATION_OUTPUT=$(compose_for_existing_clean_profiles "$EXISTING_PROJECT" "$EXISTING_DIR" \
  run --rm --no-deps --entrypoint node labeling-study-prepare scripts/normalize-retired-study-schema.js)
case "$NORMALIZATION_OUTPUT" in
  *'"applied015":true,"changed":true'*) ;;
  *) printf 'actual normalizer CLI did not report a new 015 commit\n' >&2; exit 1 ;;
esac
if [ -n "$EVIDENCE_DIR" ]; then
  printf '%s\n' "$NORMALIZATION_OUTPUT" > "$EVIDENCE_DIR/normalization-cli-result.json"
fi
POST_NORMALIZATION_PROBE="$EXISTING_DIR/host-control/normalization-post-probe.json"
node "$ROOT/test/support/normalization-harness-db.js" post-normalization \
  "$EXISTING_DATABASE_HOST" "$EXISTING_DIR" "$EXISTING_PROJECT" "$POST_NORMALIZATION_PROBE"
NORMALIZATION_ROWS_AFTER=$(node "$ROOT/test/support/normalization-harness-db.js" fingerprint \
  "$EXISTING_DATABASE_HOST" "$EXISTING_DIR" "$EXISTING_PROJECT" -)
[ "$NORMALIZATION_ROWS_AFTER" = "$NORMALIZATION_ROWS_BEFORE" ] || {
  printf 'normalization changed application rows or a prior migration ledger row\n' >&2
  exit 1
}
node --input-type=module - "$POST_NORMALIZATION_PROBE" "$NORMALIZATION_OUTPUT" "$NORMALIZATION_ROWS_BEFORE" <<'NODE'
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const [probePath, normalizationOutput, previousRows] = process.argv.slice(2);
const result = JSON.parse(readFileSync(probePath, "utf8"));
assert.deepEqual(JSON.parse(normalizationOutput), {applied015: true, changed: true});
assert.equal(result.probe.applied015, true);
assert.equal(result.probe.eligibility, "already-applied");
assert.equal(result.probe.observation.schema, "study-schema-3");
assert.equal(result.probe.observation.dataBundle, "empty");
assert.equal(result.probe.observation.readOnly.grantsVerified, true);
assert.equal(result.probe.observation.readOnly.writersStopped, true);
assert.equal(result.applicationRowsSha256, previousRows);
assert.deepEqual(result.physical, {ledger015: true, canonicalFk: true, redundantIndexesAbsent: true});
NODE
if [ -n "$EVIDENCE_DIR" ]; then
  cp "$POST_NORMALIZATION_PROBE" "$EVIDENCE_DIR/normalization-post-probe.json"
  printf '%s\n' "$NORMALIZATION_ROWS_AFTER" > "$EVIDENCE_DIR/normalization-application-rows-after.sha256"
  cp "$WORK_DIR/$EXISTING_PROJECT-handoff-binding.json" "$EVIDENCE_DIR/normalization-handoff-binding.json"
fi
printf 'STAGE_NORMALIZATION_SQL_VERIFIED_OK\n'

lock_probe=$(docker exec "$HANDOFF_CONTAINER_NAME" python3 -B \
  /workspace/test/support/locked-prepare-handoff.py --probe)
[ "$lock_probe" = "LOCK_HELD" ] || { printf 'normalization checkpoint lost the exclusive root lock\n' >&2; exit 1; }
docker kill --signal SIGUSR1 "$HANDOFF_CONTAINER_NAME" >/dev/null
node "$ROOT/test/support/wait-for-docker-log.js" "$HANDOFF_CONTAINER_NAME" NORMALIZATION_CHECKPOINTED 30000 >/dev/null
RUNNING_EXISTING_SERVICES=$(compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  ps --services --status running)
case "$RUNNING_EXISTING_SERVICES" in
  *labeling-server*|*labeling-caddy*) printf 'normalization checkpoint started an application runtime\n' >&2; exit 1 ;;
esac
node --input-type=module - "$EXISTING_DIR/host-control/normalization-report.json" <<'NODE'
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(report.reservation.phase, "normalization_verified");
assert.equal(report.reservation.journalStatus, "verified");
assert.equal(report.checkpoint.phase, "normalization_verified");
assert.equal(report.checkpoint.originPreserved, true);
assert.equal(report.checkpoint.stepBaseline.schema, "study-schema-3");
assert.equal(report.checkpoint.stepBaseline.dataBundle, "empty");
assert.equal(report.checkpoint.reservationConsumed, false);
assert.equal(report.checkpoint.publicationUnchanged, true);
NODE
if [ -n "$EVIDENCE_DIR" ]; then
  cp "$EXISTING_DIR/host-control/normalization-report.json" "$EVIDENCE_DIR/normalization-checkpoint.json"
fi
printf 'STAGE_NORMALIZATION_CHECKPOINT_STOP_OK\n'

printf 'STAGE_FRESH_POST_015_CONTINUATION_BEGIN\n'
docker kill --signal SIGUSR2 "$HANDOFF_CONTAINER_NAME" >/dev/null
POST_015_HANDOFF_ATTESTATION=$(node "$ROOT/test/support/wait-for-docker-log.js" \
  "$HANDOFF_CONTAINER_NAME" POST_015_HANDOFF_READY 30000)
node --input-type=module - "$POST_015_HANDOFF_ATTESTATION" "$WORK_DIR/$EXISTING_PROJECT-post-015-handoff.json" <<'NODE'
import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
const [encodedAttestation, outputPath] = process.argv.slice(2);
const attestation = JSON.parse(encodedAttestation);
assert.equal(attestation.lockHeld, true);
assert.equal(attestation.observation.schema, "study-schema-3");
assert.equal(attestation.observation.dataBundle, "empty");
assert.equal(attestation.observation.readOnly.grantsVerified, true);
assert.equal(attestation.observation.readOnly.writersStopped, true);
assert.deepEqual(attestation.databaseIdentity, attestation.receiptDatabaseIdentity);
writeFileSync(outputPath, `${JSON.stringify(attestation)}\n`, {mode: 0o600});
NODE
verify_config "$EXISTING_PROJECT" "$EXISTING_DIR" "$EXISTING_HTTP_PORT" "$EXISTING_HTTPS_PORT" clean "" true existing-clean
printf 'STAGE_POST_015_PREPARE_BEGIN\n'
POST_RETIREMENT_PREPARE_OUTPUT=$(compose_for_existing_clean_profiles "$EXISTING_PROJECT" "$EXISTING_DIR" \
  run --rm --no-deps --entrypoint sh labeling-study-prepare -c 'sh scripts/prepare-study-deployment.sh')
case "$POST_RETIREMENT_PREPARE_OUTPUT" in
  *"Study pr-card-sorting-local is READY"*"Study pr-card-sorting-validation-30 is READY"*) ;;
  *) printf 'fresh post-015 prepare did not create ordered 369 and 30 studies\n' >&2; exit 1 ;;
esac
POST_PREPARED_PROBE="$EXISTING_DIR/host-control/normalization-prepared-probe.json"
node "$ROOT/test/support/normalization-harness-db.js" prepared \
  "$EXISTING_DATABASE_HOST" "$EXISTING_DIR" "$EXISTING_PROJECT" "$POST_PREPARED_PROBE"
DUAL_STATE=$(compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" exec -T labeling-database \
  psql -U labeling_harness -d labeling_harness -At -c "$DUAL_SQL")
node --input-type=module - "$DUAL_STATE" "$POST_PREPARED_PROBE" <<'NODE'
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const profiles = JSON.parse(process.argv[2]);
const expected = [
    {study_key: "pr-card-sorting-local", expected_card_count: 369, bootstrap_state: "READY", participants: 3, cards: 369, accounts: 3},
    {study_key: "pr-card-sorting-validation-30", expected_card_count: 30, bootstrap_state: "READY", participants: 3, cards: 30, accounts: 3},
];
assert.deepEqual(profiles, expected);
const proof = JSON.parse(readFileSync(process.argv[3], "utf8"));
assert.equal(proof.probe.applied015, true);
assert.equal(proof.probe.observation.schema, "study-schema-3");
assert.equal(proof.probe.observation.dataBundle, "copilot369-v1");
NODE
lock_probe=$(docker exec "$HANDOFF_CONTAINER_NAME" python3 -B \
  /workspace/test/support/locked-prepare-handoff.py --probe)
[ "$lock_probe" = "LOCK_HELD" ] || { printf 'post-015 prepare released the root lock before completion\n' >&2; exit 1; }
HANDOFF_LOCK_HELD_THROUGH_PREPARE=true
if [ -n "$EVIDENCE_DIR" ]; then
  printf '%s\n' "$POST_RETIREMENT_PREPARE_OUTPUT" > "$EVIDENCE_DIR/post-retirement-prepare.log"
  cp "$WORK_DIR/$EXISTING_PROJECT-post-015-handoff.json" "$EVIDENCE_DIR/post-retirement-handoff-binding.json"
  cp "$POST_PREPARED_PROBE" "$EVIDENCE_DIR/post-retirement-study-readiness.json"
  printf '%s\n' "$DUAL_STATE" > "$EVIDENCE_DIR/post-retirement-study-state.json"
fi
printf 'STAGE_POST_015_PREPARE_OK\n'
docker kill --signal SIGWINCH "$HANDOFF_CONTAINER_NAME" >/dev/null
node "$ROOT/test/support/wait-for-docker-log.js" \
  "$HANDOFF_CONTAINER_NAME" NORMALIZATION_CONTINUATION_COMPLETE 30000 >/dev/null
node --input-type=module - "$EXISTING_DIR/host-control/normalization-report.json" <<'NODE'
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(report.checkpoint.phase, "normalization_verified");
assert.equal(report.checkpoint.reservationConsumed, false);
assert.equal(report.continuation.phase, "completed");
assert.equal(report.continuation.freshAuthorization, true);
assert.equal(report.continuation.action, "continue");
assert.equal(report.continuation.backupBaselineSchema, "study-schema-3");
assert.equal(report.continuation.backupBaselineDataBundle, "empty");
assert.equal(report.continuation.backupRestoreProofs.at(-1).archiveScope, "full-database");
assert.equal(report.continuation.backupRestoreProofs.at(-1).syntheticFixture, true);
assert.equal(report.continuation.backupRestoreProofs.at(-1).hostBoundaryAccepted, true);
assert.ok(report.runtimeSpies.includes("runtime-spy:labeling-server,labeling-caddy"));
NODE
if [ -n "$EVIDENCE_DIR" ]; then
  cp "$EXISTING_DIR/host-control/normalization-report.json" "$EVIDENCE_DIR/normalization-report.json"
fi
printf 'STAGE_FRESH_POST_015_CONTINUATION_OK\n'
printf 'STAGE_POST_RETIREMENT_INITIALIZATION_OK\n'

compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  up --no-build --no-deps --wait --wait-timeout 180 labeling-server
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  up --no-build --no-deps --wait --wait-timeout 180 labeling-caddy
EXISTING_RUNNING_IMAGE=$(docker inspect --format '{{.Image}}' "${EXISTING_PROJECT}-server")
[ "$EXISTING_RUNNING_IMAGE" = "$CLEAN_SERVER_IMAGE" ] || { printf 'post-retirement runtime differs from the selected fixture image\n' >&2; exit 1; }
assert_runtime_ports "$EXISTING_PROJECT" "$EXISTING_DIR" "$EXISTING_HTTP_PORT" "$EXISTING_HTTPS_PORT" "$ROOT/deployment/docker-compose.existing.yml"
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" exec -T labeling-database \
  psql -v ON_ERROR_STOP=1 -U labeling_harness -d labeling_harness -c "$SEED_SQL" >/dev/null
EXISTING_BEFORE=$(database_schema_data_fingerprint "$EXISTING_PROJECT")
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" restart labeling-database >/dev/null
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  up --no-build --no-deps --wait --wait-timeout 180 labeling-database >/dev/null
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" restart labeling-server labeling-caddy >/dev/null
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" \
  up --no-build --no-deps --wait --wait-timeout 180 labeling-server labeling-caddy >/dev/null
[ "$(database_schema_data_fingerprint "$EXISTING_PROJECT")" = "$EXISTING_BEFORE" ] \
  || { printf 'post-retirement runtime restart changed persisted 369/30 state\n' >&2; exit 1; }
if [ -n "$EVIDENCE_DIR" ]; then
  printf '%s\n' "$EXISTING_BEFORE" > "$EVIDENCE_DIR/post-retirement-before-restart.sha256"
  printf '%s\n' "$EXISTING_BEFORE" > "$EVIDENCE_DIR/post-retirement-after-restart.sha256"
  printf 'post_retirement_runtime=healthy\n369_30_state_persisted=true\n' \
    > "$EVIDENCE_DIR/post-retirement-persistence.txt"
fi
printf 'STAGE_POST_RETIREMENT_PERSISTENCE_OK\n'
stop_handoff_owner
rm "$EXISTING_DIR/handoff.yml" "$EXISTING_DIR/retired-mode.yml"
printf 'STAGE_NORMALIZATION_OWNER_CLEANUP_OK\n'

printf 'DEPLOYMENT_HARNESS_OK clean=%s existing=%s\n' "$CLEAN_PROJECT" "$EXISTING_PROJECT"
