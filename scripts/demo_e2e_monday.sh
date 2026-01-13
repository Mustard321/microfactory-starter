#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/load_env.sh"

EVENTS_URL="$SUPABASE_URL/rest/v1/events?select=event_type,at,site_slug,job_id,payload&event_type=in.(JOB_QUEUED,JOB_FAILED,JOB_SUCCEEDED,SITE_GENERATED,INTAKE_FAILED,CRON_TICK)&order=at.desc&limit=5"
JOBS_URL="$SUPABASE_URL/rest/v1/jobs?select=id,site_slug,status,last_error,updated_at&order=updated_at.desc&limit=5"
SITES_URL="$SUPABASE_URL/rest/v1/sites?select=slug,status,published_url,updated_at&order=updated_at.desc&limit=5"

header_auth=("-H" "apikey: $SUPABASE_SERVICE_ROLE_KEY" "-H" "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")

events_json=$(curl -sS "$EVENTS_URL" "${header_auth[@]}")
jobs_json=$(curl -sS "$JOBS_URL" "${header_auth[@]}")
sites_json=$(curl -sS "$SITES_URL" "${header_auth[@]}")

printf "DEMO REPORT (text-only)\n\n"
printf "Last 5 events (truncated):\n"
printf "%s" "$events_json" | head -c 400
printf "\n\n"

printf "Last 5 jobs (truncated):\n"
printf "%s" "$jobs_json" | head -c 400
printf "\n\n"

printf "Last 5 sites (truncated):\n"
printf "%s" "$sites_json" | head -c 400
printf "\n\n"

latest_slug=$(JOBS_JSON="$jobs_json" SITES_JSON="$sites_json" node -e '
const sites = JSON.parse(process.env.SITES_JSON || "[]");
const s = sites[0] || {};
console.log(s.slug || "");
')

if [ -n "$latest_slug" ]; then
  printf "site_public HEAD (status + content-type):\n"
  curl -sI "https://ndzrxomconvvrvwkgnor.functions.supabase.co/site_public/${latest_slug}" \
    | awk 'NR==1 || tolower($1)=="content-type:"' \
    | head -n 2
else
  printf "site_public HEAD (status + content-type):\n"
  printf "missing latest site slug\n"
fi
