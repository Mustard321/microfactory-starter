#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/load_env.sh"

JOB_RUNNER_URL="${JOB_RUNNER_URL:-https://ndzrxomconvvrvwkgnor.functions.supabase.co/job_runner}"

curl -sS -X POST "$JOB_RUNNER_URL" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  | head -c 400
