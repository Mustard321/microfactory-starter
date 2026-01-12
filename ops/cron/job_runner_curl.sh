#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ -f "${ROOT_DIR}/supabase/.env.secrets" ]; then
  set -a
  source "${ROOT_DIR}/supabase/.env.secrets"
  set +a
fi

: "${CRON_SECRET:?CRON_SECRET is required}"

JOB_RUNNER_URL="${JOB_RUNNER_URL:-https://ndzrxomconvvrvwkgnor.functions.supabase.co/job_runner}"

resp="$(curl -sS -X POST "${JOB_RUNNER_URL}" -H "x-cron-secret: ${CRON_SECRET}")"

node -e 'const fs=require("fs"); const input=fs.readFileSync(0,"utf8"); let ok=false; try{const data=JSON.parse(input||"{}"); ok=!!data.ok;}catch{} if(!ok){console.error("job_runner returned non-ok"); process.exit(1);}' <<< "${resp}"
