#!/bin/sh

set -eu

GITHUB_ENRICHMENT_ENABLED="${GITHUB_ENRICHMENT_ENABLED:-false}"
export GITHUB_ENRICHMENT_ENABLED

if [ -n "${STUDY_PROFILES_INPUT:-}" ] && [ -n "${STUDY_CONFIG_INPUT:-}" ]; then
  echo "STUDY_PROFILES_INPUT and STUDY_CONFIG_INPUT cannot be used together" >&2
  exit 1
fi

case "${STUDY_DATABASE_MODE:-}" in
  clean|existing)
    ;;
  *)
    echo "STUDY_DATABASE_MODE must be clean or existing" >&2
    exit 1
    ;;
esac

if [ -n "${STUDY_PROFILES_INPUT:-}" ]; then
  if [ "${STUDY_DATABASE_MODE}" = "existing" ]; then
    echo "STUDY_PROFILES_INPUT requires STUDY_DATABASE_MODE=clean" >&2
    exit 1
  fi
  npm run validate:study-profiles
elif [ -n "${STUDY_CONFIG_INPUT:-}" ]; then
  npm run validate:study-bootstrap -- "${STUDY_CSV_PATH:?STUDY_CSV_PATH is required}" "${STUDY_CONFIG_INPUT}"
else
  npm run validate:study-bootstrap -- "${STUDY_CSV_PATH:?STUDY_CSV_PATH is required}"
fi

case "${STUDY_DATABASE_MODE}" in
  clean)
    npm run retire:legacy:clean-check
    npm run migrate:study
    ;;
  existing)
    if [ "${LEGACY_RETIREMENT_CONFIRM:-}" != "retire-legacy-labeler" ]; then
      echo "Existing mode requires LEGACY_RETIREMENT_CONFIRM=retire-legacy-labeler" >&2
      exit 1
    fi
    if [ ! -r "${LEGACY_BACKUP_ARCHIVE:-}" ] || [ ! -r "${LEGACY_BACKUP_MANIFEST:-}" ]; then
      echo "Existing mode requires readable external backup archive and manifest paths" >&2
      exit 1
    fi
    if [ ! -r "${PGPASSFILE:-}" ]; then
      echo "Existing mode requires a readable external retirement passfile" >&2
      exit 1
    fi
    npm run migrate:study -- --through 001_study_foundation
    npm run retire:legacy:apply
    npm run migrate:study
    ;;
esac

if [ -n "${STUDY_PROFILES_INPUT:-}" ]; then
  npm run prepare:study-profiles
elif [ -n "${STUDY_CONFIG_INPUT:-}" ]; then
  npm run bootstrap:study -- "${STUDY_CSV_PATH}" "${STUDY_CONFIG_INPUT}"
  npm run enrich:study -- "${STUDY_CSV_PATH}" "${STUDY_CONFIG_INPUT}"
else
  npm run bootstrap:study -- "${STUDY_CSV_PATH}"
  npm run enrich:study -- "${STUDY_CSV_PATH}"
fi
