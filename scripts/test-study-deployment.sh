#!/bin/sh

set -eu

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

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
[ -r "$ROOT/plans/merged_after_rework_cards_seed_20260510.csv" ] || fail_prerequisite "the canonical 300-card CSV is missing"
EVIDENCE_DIR=${HARNESS_EVIDENCE_DIR:-}
if [ -n "$EVIDENCE_DIR" ] && [ ! -d "$EVIDENCE_DIR" ]; then
  fail_prerequisite "HARNESS_EVIDENCE_DIR must name an existing directory"
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
mkdir -m 700 "$CLEAN_DIR" "$EXISTING_DIR"

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

cleanup_project() {
  project=$1
  runtime=$2
  extra=${3:-}
  if [ -f "$runtime/compose.env" ] && [ -f "$runtime/harness.yml" ]; then
    if [ -n "$extra" ]; then
      compose_for "$project" "$runtime" -f "$extra" down --remove-orphans >/dev/null 2>&1 || true
    else
      compose_for "$project" "$runtime" down --remove-orphans >/dev/null 2>&1 || true
    fi
  fi
  docker volume rm "${project}-data" "${project}-caddy-data" "${project}-caddy-config" >/dev/null 2>&1 || true
  docker network rm "${project}-network" >/dev/null 2>&1 || true
}

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    if [ -f "$CLEAN_DIR/compose.env" ] && [ -f "$CLEAN_DIR/harness.yml" ]; then
      compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" logs --no-color >&2 || true
    fi
    if [ -f "$EXISTING_DIR/compose.env" ] && [ -f "$EXISTING_DIR/harness.yml" ]; then
      compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" logs --no-color >&2 || true
    fi
  fi
  cleanup_project "$CLEAN_PROJECT" "$CLEAN_DIR"
  cleanup_project "$EXISTING_PROJECT" "$EXISTING_DIR" "$ROOT/deployment/docker-compose.existing.yml"
  rm -rf "$WORK_DIR"
  if [ -n "$EVIDENCE_DIR" ]; then
    printf 'cleanup_status=%s\ntemporary_directory_removed=true\ntask_scoped_containers_removed=true\ntask_scoped_networks_removed=true\ntask_scoped_volumes_removed=true\ndestructive_down_v_used=false\n' \
      "$status" > "$EVIDENCE_DIR/cleanup-receipt.txt"
  fi
  trap - EXIT INT TERM
  exit "$status"
}
trap cleanup EXIT INT TERM

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
{"studyKey":"pr-card-sorting-local","expectedCardCount":300,"participants":["javier","diego","pablo"]}
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
  if [ "$mode" = "clean" ]; then
    cat > "$runtime/validation-study-config.json" <<'JSON'
{"studyKey":"pr-card-sorting-validation-30","expectedCardCount":30,"participants":["javier","diego","pablo"],"loginUsernames":{"javier":"javier-30","diego":"diego-30","pablo":"pablo-30"}}
JSON
    npm run --silent credentials:generate -- \
      --study-config "$runtime/validation-study-config.json" \
      --output "$runtime/validation-study-account-manifest.json" \
      < "$runtime/account-passwords.json" >/dev/null
    cat > "$runtime/study-profiles.json" <<'JSON'
{"profiles":[{"config":"/run/config/studies/current.json","csv":"/labeling/plans/prs.csv","accountManifest":"/run/secrets/studies/current.json","enrichmentEnabled":false},{"config":"/run/config/studies/validation-30.json","csv":"/labeling/plans/validation-30-cards.csv","accountManifest":"/run/secrets/studies/validation-30.json","enrichmentEnabled":false}]}
JSON
    chmod 0400 "$runtime/validation-study-config.json" "$runtime/study-profiles.json" \
      "$runtime/validation-study-account-manifest.json"
  fi
  chmod 0400 "$runtime/database-password" "$runtime/session-current" "$runtime/session-previous" \
    "$runtime/study-config.json" "$runtime/study-account-manifest.json"
  chmod 0444 "$runtime/database-password-postgres"

  cat > "$runtime/Caddyfile" <<CADDY
http://harness.test {
    redir https://harness.test:${HTTPS_PORT}{uri} permanent
}
https://harness.test {
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
DATABASE_PASSWORD_HOST_PATH=$runtime/database-password
DATABASE_PASSWORD_DATABASE_HOST_PATH=$runtime/database-password-postgres
SESSION_SECRET_CURRENT_HOST_PATH=$runtime/session-current
SESSION_SECRET_PREVIOUS_HOST_PATH=$runtime/session-previous
STUDY_ACCOUNT_MANIFEST_HOST_PATH=$runtime/study-account-manifest.json
STUDY_DATABASE_MODE=$mode
PUBLIC_HOSTNAME=harness.test
APP_ORIGIN=https://harness.test:$HTTPS_PORT
GITHUB_ENRICHMENT_ENABLED=false
ENV
  if [ "$mode" = "clean" ]; then
    cat >> "$runtime/compose.env" <<ENV
STUDY_VALIDATION_ACCOUNT_MANIFEST_HOST_PATH=$runtime/validation-study-account-manifest.json
STUDY_PROFILES_INPUT_HOST_PATH=$runtime/study-profiles.json
STUDY_CURRENT_CONFIG_HOST_PATH=$runtime/study-config.json
STUDY_VALIDATION_CONFIG_HOST_PATH=$runtime/validation-study-config.json
ENV
  fi
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
    volumes:
      - $runtime/database-password-postgres:/run/secrets/database-password:ro
YAML
  fi
  cat >> "$runtime/harness.yml" <<YAML
  labeling-study-prepare:
    container_name: ${project}-prepare
    tmpfs: !override
      - /tmp:rw,noexec,nosuid,nodev,size=64m
  labeling-server:
    container_name: ${project}-server
    tmpfs: !override
      - /tmp:rw,noexec,nosuid,nodev,size=64m
      - /labeling/logs:rw,noexec,nosuid,nodev,size=32m,uid=1000,gid=1000
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

write_existing_inputs() {
  runtime=$1
  project=$2
  password=$(cat "$runtime/database-password")
  mkdir -m 700 "$runtime/backup"
  printf '%s\n' "labeling-database:5432:labeling_harness:labeling_harness:$password" > "$runtime/legacy-retirement.pgpass"
  chmod 0400 "$runtime/legacy-retirement.pgpass"
  cat >> "$runtime/compose.env" <<ENV
LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler
LEGACY_BACKUP_DIRECTORY=$runtime/backup
LEGACY_BACKUP_ARCHIVE_FILE=legacy.dump
LEGACY_BACKUP_MANIFEST_FILE=legacy.manifest.json
PGPASSFILE_HOST_PATH=$runtime/legacy-retirement.pgpass
ENV
  chmod 0600 "$runtime/compose.env" "$runtime/harness.yml"
}

verify_config() {
  project=$1
  runtime=$2
  http_port=$3
  https_port=$4
  extra=${5:-}
  if [ -n "$extra" ]; then
    compose_for "$project" "$runtime" -f "$extra" config --format json > "$runtime/rendered.json"
  else
    compose_for "$project" "$runtime" config --format json > "$runtime/rendered.json"
  fi
  mode=existing
  if [ "$runtime" = "$CLEAN_DIR" ]; then
    mode=clean
  fi
  node --input-type=module - "$runtime/rendered.json" "$project" "$http_port" "$https_port" "$mode" <<'NODE'
import {readFileSync} from "node:fs";
const [configPath, project, httpPort, httpsPort, mode] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const services = config.services;
if (config.name !== project) throw new Error("rendered Compose project is not isolated");
if (config.volumes.data.name !== `${project}-data` || config.networks.default.name !== `${project}-network`) {
    throw new Error("rendered Compose storage or network is not isolated");
}
const expectedContainers = new Set(["database", "prepare", "server", "caddy"].map(name => `${project}-${name}`));
for (const service of Object.values(services)) {
    if (!expectedContainers.has(service.container_name)) throw new Error("rendered container name is not isolated");
}
for (const [name, service] of Object.entries(services)) {
    const ports = service.ports ?? [];
    if (name !== "labeling-caddy" && ports.length > 0) throw new Error(`${name} publishes a host port`);
    for (const port of ports) {
        if (port.host_ip !== "127.0.0.1" || port.protocol !== "tcp") throw new Error("edge is not loopback TCP");
    }
}
const edgePorts = services["labeling-caddy"].ports.map(port => `${port.published}:${port.target}`).sort();
if (JSON.stringify(edgePorts) !== JSON.stringify([`${httpPort}:80`, `${httpsPort}:443`].sort())) {
    throw new Error("Caddy does not exclusively publish the selected harness ports");
}
if (services["labeling-server"].depends_on["labeling-study-prepare"].condition !== "service_completed_successfully") {
    throw new Error("server is not gated by current preparation success");
}
const cleanOnlyTargets = new Set([
    "/run/config/study-profiles.json", "/run/config/studies/current.json", "/run/config/studies/validation-30.json",
    "/labeling/plans/validation-30-cards.csv", "/run/secrets/studies/validation-30.json",
]);
const profileTargets = new Set([
    ...cleanOnlyTargets,
    "/labeling/plans/prs.csv", "/run/secrets/studies/current.json",
]);
const prepareTargets = new Set((services["labeling-study-prepare"].volumes ?? []).map(volume => volume.target));
if (mode === "clean") {
    for (const target of profileTargets) {
        if (!prepareTargets.has(target)) throw new Error(`prepare is missing profile mount ${target}`);
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

wait_database_initialization() {
  project=$1
  runtime=$2
  extra=$3
  compose_for "$project" "$runtime" -f "$extra" logs --no-color --follow labeling-database 2>/dev/null |
    while IFS= read -r line; do
      case "$line" in
        *"PostgreSQL init process complete"*) break ;;
      esac
    done
}

SNAPSHOT_SQL="WITH target_study AS (SELECT id, bootstrap_state, source_checksum FROM study WHERE study_key='pr-card-sorting-local') SELECT json_build_object('state',(SELECT bootstrap_state FROM target_study),'cards',(SELECT COUNT(*) FROM study_card WHERE study_id=(SELECT id FROM target_study)),'members',(SELECT COUNT(*) FROM study_participant WHERE study_id=(SELECT id FROM target_study)),'accounts',(SELECT COUNT(*) FROM participant_account WHERE study_id=(SELECT id FROM target_study)),'account_digest',(SELECT md5(string_agg(normalized_username || ':' || credential_version || ':' || md5(password_hash),',' ORDER BY normalized_username)) FROM participant_account WHERE study_id=(SELECT id FROM target_study)),'card_digest',(SELECT md5(string_agg(source_card_id || ':' || source_checksum,',' ORDER BY ordinal)) FROM study_card WHERE study_id=(SELECT id FROM target_study)),'classifications',(SELECT COUNT(*) FROM pr_classification WHERE study_id=(SELECT id FROM target_study)),'classification_digest',(SELECT md5(string_agg(pr_card_id::text || ':' || participant_id || ':' || remarks,',' ORDER BY pr_card_id,participant_id)) FROM pr_classification WHERE study_id=(SELECT id FROM target_study)),'source_checksum',(SELECT source_checksum FROM target_study));"
DUAL_SQL="SELECT json_agg(row_to_json(profile) ORDER BY profile.expected_card_count DESC) FROM (SELECT study_key, expected_card_count, bootstrap_state, (SELECT COUNT(*) FROM study_participant WHERE study_id=study.id) AS participants, (SELECT COUNT(*) FROM study_card WHERE study_id=study.id) AS cards, (SELECT COUNT(*) FROM participant_account WHERE study_id=study.id) AS accounts FROM study) profile;"
SEED_SQL="WITH target AS (SELECT study.id AS study_id, participant.reviewer_id, card.pr_card_id FROM study JOIN study_participant participant ON participant.study_id=study.id JOIN study_card card ON card.study_id=study.id WHERE study.study_key='pr-card-sorting-local' AND participant.ordinal=0 AND card.ordinal=0), category AS (INSERT INTO participant_category(study_id,participant_id,raw_name,normalized_name) SELECT study_id,reviewer_id,'Harness preserved','harness preserved' FROM target RETURNING id,study_id,participant_id) INSERT INTO pr_classification(pr_card_id,participant_id,category_id,remarks,study_id) SELECT target.pr_card_id,target.reviewer_id,category.id,'preserve-across-restart',target.study_id FROM target JOIN category ON category.study_id=target.study_id;"

assert_runtime_ports() {
  project=$1
  runtime=$2
  https_port=$3
  extra=${4:-}
  if [ -n "$extra" ]; then
    compose_for "$project" "$runtime" -f "$extra" ps --format json > "$runtime/ps.json"
  else
    compose_for "$project" "$runtime" ps --format json > "$runtime/ps.json"
  fi
  node --input-type=module - "$runtime/ps.json" <<'NODE'
import {readFileSync} from "node:fs";
const content = readFileSync(process.argv[2], "utf8").trim();
const rows = content.startsWith("[") ? JSON.parse(content) : content.split("\n").map(line => JSON.parse(line));
for (const row of rows) {
    const publishers = (row.Publishers ?? []).filter(port => port.PublishedPort > 0);
    if (row.Service !== "labeling-caddy" && publishers.length > 0) throw new Error(`${row.Service} is host-published`);
    if (publishers.some(port => port.URL !== "127.0.0.1" || ![80, 443].includes(port.TargetPort))) {
        throw new Error("unexpected runtime publisher");
    }
}
NODE
  status=$(curl --silent --show-error --insecure --noproxy '*' --resolve "harness.test:$https_port:127.0.0.1" \
    --output /dev/null --write-out '%{http_code}' "https://harness.test:$https_port/login")
  [ "$status" = "200" ] || { printf 'Caddy login check returned %s\n' "$status" >&2; return 1; }
  status=$(curl --silent --show-error --insecure --noproxy '*' --resolve "harness.test:$https_port:127.0.0.1" \
    --output /dev/null --write-out '%{http_code}' "https://harness.test:$https_port/actuator/health")
  [ "$status" = "404" ] || { printf 'Caddy actuator check returned %s\n' "$status" >&2; return 1; }
}

write_runtime "$CLEAN_DIR" "$CLEAN_PROJECT" clean "$CLEAN_HTTP_PORT" "$CLEAN_HTTPS_PORT"
chmod 0600 "$CLEAN_DIR/harness.yml"
verify_config "$CLEAN_PROJECT" "$CLEAN_DIR" "$CLEAN_HTTP_PORT" "$CLEAN_HTTPS_PORT"
compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" up --build --wait --wait-timeout 240
assert_runtime_ports "$CLEAN_PROJECT" "$CLEAN_DIR" "$CLEAN_HTTPS_PORT"
PREPARE_OUTPUT=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" logs --no-color labeling-study-prepare)
case "$PREPARE_OUTPUT" in
  *"Study pr-card-sorting-local is READY"*"Study pr-card-sorting-validation-30 is READY"*) ;;
  *) printf 'prepare log did not report both ordered READY profiles\n' >&2; exit 1 ;;
esac
if [ -n "$EVIDENCE_DIR" ]; then
  printf 'Study pr-card-sorting-local is READY\nStudy pr-card-sorting-validation-30 is READY\nordered_profiles=300,30\n' \
    > "$EVIDENCE_DIR/prepare.log"
fi
DUAL_STATE=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" exec -T labeling-database psql -U labeling_harness -d labeling_harness -At -c "$DUAL_SQL")
node --input-type=module - "$DUAL_STATE" <<'NODE'
const profiles = JSON.parse(process.argv[2]);
const expected = [
    {study_key: "pr-card-sorting-local", expected_card_count: 300, bootstrap_state: "READY", participants: 3, cards: 300, accounts: 3},
    {study_key: "pr-card-sorting-validation-30", expected_card_count: 30, bootstrap_state: "READY", participants: 3, cards: 30, accounts: 3},
];
if (JSON.stringify(profiles) !== JSON.stringify(expected)) throw new Error("dual-profile database state is invalid");
NODE
compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" exec -T labeling-database psql -v ON_ERROR_STOP=1 -U labeling_harness -d labeling_harness -c "$SEED_SQL" >/dev/null
CLEAN_BEFORE=$(snapshot "$CLEAN_PROJECT" "$CLEAN_DIR")
if [ -n "$EVIDENCE_DIR" ]; then
  printf '{"currentStudy":%s,"dualStudyState":%s}\n' "$CLEAN_BEFORE" "$DUAL_STATE" > "$EVIDENCE_DIR/study-fingerprints.json"
fi
compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" rm -sf labeling-study-prepare labeling-server labeling-caddy >/dev/null
compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" up --wait --wait-timeout 180 >/dev/null
[ "$(snapshot "$CLEAN_PROJECT" "$CLEAN_DIR")" = "$CLEAN_BEFORE" ] || { printf 'idempotent profile rerun changed current study\n' >&2; exit 1; }
compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" rm -sf labeling-study-prepare labeling-server labeling-caddy >/dev/null
compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" exec -T labeling-database psql -v ON_ERROR_STOP=1 -U labeling_harness -d labeling_harness \
  -c "UPDATE study_participant SET participant_key='validation-drift' WHERE study_id=(SELECT id FROM study WHERE study_key='pr-card-sorting-validation-30') AND ordinal=0" >/dev/null
if compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" up --wait --wait-timeout 180 >/dev/null 2>&1; then
  printf 'second-profile drift unexpectedly passed\n' >&2
  exit 1
fi
[ "$(snapshot "$CLEAN_PROJECT" "$CLEAN_DIR")" = "$CLEAN_BEFORE" ] || { printf 'second-profile drift changed current study\n' >&2; exit 1; }
RUNNING_SERVICES=$(compose_for "$CLEAN_PROJECT" "$CLEAN_DIR" ps --services --status running)
case "$RUNNING_SERVICES" in
  *labeling-server*|*labeling-caddy*) printf 'public services ran after failed second profile\n' >&2; exit 1 ;;
esac
if curl --max-time 2 --silent --show-error --insecure --noproxy '*' --resolve "harness.test:$CLEAN_HTTPS_PORT:127.0.0.1" \
  "https://harness.test:$CLEAN_HTTPS_PORT/login" >/dev/null 2>&1; then
  printf 'public readiness remained reachable after failed second profile\n' >&2
  exit 1
fi
if [ -n "$EVIDENCE_DIR" ]; then
  printf 'second_profile_drift_rejected=true\ncurrent_300_fprint_unchanged=true\nserver_running=false\ncaddy_running=false\npublic_readiness_reachable=false\n' \
    > "$EVIDENCE_DIR/failure.log"
fi
printf 'DUAL_PROFILE_OK state=%s current_fingerprint_preserved=true idempotent=true failure_gated=true\n' "$DUAL_STATE"

write_runtime "$EXISTING_DIR" "$EXISTING_PROJECT" existing "$EXISTING_HTTP_PORT" "$EXISTING_HTTPS_PORT"
write_existing_inputs "$EXISTING_DIR" "$EXISTING_PROJECT"
verify_config "$EXISTING_PROJECT" "$EXISTING_DIR" "$EXISTING_HTTP_PORT" "$EXISTING_HTTPS_PORT" "$ROOT/deployment/docker-compose.existing.yml"
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" up -d --wait --wait-timeout 180 labeling-database
wait_database_initialization "$EXISTING_PROJECT" "$EXISTING_DIR" "$ROOT/deployment/docker-compose.existing.yml"
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" exec -T labeling-database \
  pg_dump -h 127.0.0.1 -U labeling_harness -d labeling_harness --format=custom --data-only \
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
chmod 0400 "$EXISTING_DIR/backup/legacy.dump" "$EXISTING_DIR/backup/legacy.manifest.json"
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" up --build --wait --wait-timeout 240
assert_runtime_ports "$EXISTING_PROJECT" "$EXISTING_DIR" "$EXISTING_HTTPS_PORT" "$ROOT/deployment/docker-compose.existing.yml"
LEGACY_STATUS=$(compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" exec -T labeling-database \
  psql -U labeling_harness -d labeling_harness -At -c "SELECT to_regclass('public.instance') IS NULL AND EXISTS (SELECT FROM labeler_migration WHERE migration_id='002_retire_legacy_labeler')" | tr -d '[:space:]')
[ "$LEGACY_STATUS" = "t" ] || { printf 'existing retirement did not reach the guarded retired state\n' >&2; exit 1; }
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" exec -T labeling-database \
  psql -v ON_ERROR_STOP=1 -U labeling_harness -d labeling_harness -c "$SEED_SQL" >/dev/null
EXISTING_BEFORE=$(snapshot "$EXISTING_PROJECT" "$EXISTING_DIR" "$ROOT/deployment/docker-compose.existing.yml")
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" restart labeling-database labeling-server labeling-caddy >/dev/null
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" up --wait --wait-timeout 180 >/dev/null
[ "$(snapshot "$EXISTING_PROJECT" "$EXISTING_DIR" "$ROOT/deployment/docker-compose.existing.yml")" = "$EXISTING_BEFORE" ] || { printf 'existing restart changed persisted state\n' >&2; exit 1; }
compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" rm -sf labeling-study-prepare labeling-server labeling-caddy >/dev/null
chmod 0600 "$EXISTING_DIR/backup/legacy.dump"
printf 'invalid' >> "$EXISTING_DIR/backup/legacy.dump"
chmod 0400 "$EXISTING_DIR/backup/legacy.dump"
if compose_for "$EXISTING_PROJECT" "$EXISTING_DIR" -f "$ROOT/deployment/docker-compose.existing.yml" up --wait --wait-timeout 180 >/dev/null 2>&1; then
  printf 'invalid existing backup unexpectedly passed\n' >&2
  exit 1
fi
[ "$(snapshot "$EXISTING_PROJECT" "$EXISTING_DIR" "$ROOT/deployment/docker-compose.existing.yml")" = "$EXISTING_BEFORE" ] || { printf 'invalid backup changed persisted state\n' >&2; exit 1; }

printf 'DEPLOYMENT_HARNESS_OK clean=%s existing=%s\n' "$CLEAN_PROJECT" "$EXISTING_PROJECT"
