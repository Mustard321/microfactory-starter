#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_FILE="${ROOT_DIR}/supabase/.env.secrets"

if [ -f "$SECRETS_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
  set +a
fi

required=(CRON_SECRET OPS_SECRET MONDAY_WEBHOOK_TOKEN SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY)
missing=()
for var in "${required[@]}"; do
  if [ -z "${!var:-}" ]; then
    missing+=("$var")
  fi
done

if [ ${#missing[@]} -ne 0 ]; then
  echo "Missing required env vars: ${missing[*]}" >&2
  exit 1
fi
