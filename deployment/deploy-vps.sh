#!/usr/bin/env bash
set -Eeuo pipefail
exec python3 -B "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")/host/control.py" "$@"
