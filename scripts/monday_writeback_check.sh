#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/load_env.sh"

MONDAY_ITEM_ID="${MONDAY_ITEM_ID:-${1:-}}"
if [ -z "$MONDAY_ITEM_ID" ]; then
  echo "Missing MONDAY_ITEM_ID (env or arg)" >&2
  exit 1
fi

header_auth=("-H" "apikey: $SUPABASE_SERVICE_ROLE_KEY" "-H" "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")

EVENTS_URL="$SUPABASE_URL/rest/v1/events?select=event_type,at,site_slug,payload&event_type=in.(MONDAY_WRITEBACK_ATTEMPT,MONDAY_WRITEBACK_SUCCESS,MONDAY_WRITEBACK_FAILED)&or=(payload->>monday_item_id.eq.${MONDAY_ITEM_ID},payload->>item_id.eq.${MONDAY_ITEM_ID})&order=at.desc&limit=20"

events_json=$(curl -sS "$EVENTS_URL" "${header_auth[@]}")

printf "WRITEBACK REPORT (text-only)\n\n"

EVENTS_JSON="$events_json" node -e '
const events = JSON.parse(process.env.EVENTS_JSON || "[]");
let counts = { MONDAY_WRITEBACK_ATTEMPT: 0, MONDAY_WRITEBACK_SUCCESS: 0, MONDAY_WRITEBACK_FAILED: 0 };
let lastAttempt = null;
let lastFailed = null;
for (const e of events) {
  if (!e || !e.event_type) continue;
  if (counts[e.event_type] !== undefined) counts[e.event_type] += 1;
  if (!lastAttempt && e.event_type === "MONDAY_WRITEBACK_ATTEMPT") lastAttempt = e;
  if (!lastFailed && e.event_type === "MONDAY_WRITEBACK_FAILED") lastFailed = e;
}
function trunc(s, n){
  if(!s) return "";
  if(s.length <= n) return s;
  return s.slice(0, n - 3) + "...";
}
console.log("counts:");
console.log(`- attempt: ${counts.MONDAY_WRITEBACK_ATTEMPT}`);
console.log(`- success: ${counts.MONDAY_WRITEBACK_SUCCESS}`);
console.log(`- failed: ${counts.MONDAY_WRITEBACK_FAILED}`);
console.log("");
if (lastAttempt) {
  const payload = JSON.stringify(lastAttempt.payload || {});
  console.log("last_attempt_payload:");
  console.log(trunc(payload, 600));
  console.log("");
}
if (lastFailed) {
  const err = lastFailed.payload && lastFailed.payload.error ? String(lastFailed.payload.error) : "";
  console.log("last_failed_error:");
  console.log(trunc(err, 400));
}
' 2>/dev/null
