#!/usr/bin/env bash
# Smoke test for process-incident-turn (text mode, Scenario B) against LOCAL Supabase.
# Prereqs: npx supabase start; node scripts/seed-hosted-dev-accounts.mjs (local env);
#          npx supabase functions serve --env-file supabase/functions/.env
# Usage:   bash scripts/curl/process-incident-turn.sh
# Optional env overrides: SUPABASE_URL, SUPABASE_ANON_KEY, DEV_EMAIL, DEV_PASSWORD
# Needs curl and node (used for JSON parsing instead of jq).
set -euo pipefail

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_ANON_KEY:-}" ]]; then
  STATUS="$(npx supabase status -o env 2>/dev/null)"
  get() { printf '%s\n' "$STATUS" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" | tr -d '\r'; }
  SUPABASE_URL="${SUPABASE_URL:-$(get API_URL)}"
  SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$(get PUBLISHABLE_KEY)}"
  SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$(get ANON_KEY)}"
fi
[[ -n "$SUPABASE_URL" && -n "$SUPABASE_ANON_KEY" ]] || { echo "Local Supabase is not running (npx supabase start)." >&2; exit 1; }

EMAIL="${DEV_EMAIL:-driver+dev1@jebel.local}"
PASSWORD="${DEV_PASSWORD:-DevDriver#101}"
json_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(typeof v==="string"?v:JSON.stringify(v))})' "$1"; }
pretty() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s),null,2))}catch{console.log(s)}})'; }

echo "1. Sign in as $EMAIL"
LOGIN_BODY="$(node -e 'console.log(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$EMAIL" "$PASSWORD")"
TOKEN="$(curl -sS -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' -d "$LOGIN_BODY" | json_get access_token)"
[[ -n "$TOKEN" && "$TOKEN" != "undefined" ]] || { echo "Sign-in failed" >&2; exit 1; }

echo "2. Create draft (rpc create_incident_draft)"
REVISION_ID="$(curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/create_incident_draft" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' | tr -d '"')"
echo "   revision: $REVISION_ID"

CLIENT_TURN_ID="$(node -e 'console.log(crypto.randomUUID())')"
TEXT="A silver sedan cut in front of me from the right lane on I-35 north near exit 235 and braked hard. I couldn't stop, hit the back of it at low speed and my trailer clipped the fence of the gas station. Police came. Nobody was hurt. Front bumper is bent."
BODY="$(node -e 'console.log(JSON.stringify({incident_revision_id:process.argv[1],client_turn_id:process.argv[2],question_key:"what_happened",text:process.argv[3]}))' "$REVISION_ID" "$CLIENT_TURN_ID" "$TEXT")"

call() {
  curl -sS -X POST "$SUPABASE_URL/functions/v1/process-incident-turn" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$BODY"
}

echo "3. process-incident-turn (text, Scenario B)"
FIRST="$(call)"
printf '%s' "$FIRST" | pretty

echo
echo "4. Same client_turn_id again (idempotency)"
SECOND="$(call)"
printf '%s' "$SECOND" | pretty

echo
if [[ "$FIRST" == "$SECOND" ]]; then echo "Identical responses: true"; else echo "Identical responses: false"; exit 1; fi
printf 'Applied keys: '
printf '%s' "$FIRST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).applied.map(a=>a.key).join(", ")))'
