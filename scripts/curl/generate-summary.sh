#!/usr/bin/env bash
# Smoke test for generate-summary against a running local or hosted Supabase project.
# Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_ACCESS_TOKEN=... INCIDENT_REVISION_ID=... \
#        bash scripts/curl/generate-summary.sh
set -euo pipefail

: "${SUPABASE_URL:?Set SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY}"
: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN to a driver's access token}"
: "${INCIDENT_REVISION_ID:?Set INCIDENT_REVISION_ID to a revision visible to that driver}"

BODY="$(node -e 'console.log(JSON.stringify({incident_revision_id:process.argv[1]}))' "$INCIDENT_REVISION_ID")"
RESPONSE="$(curl -fsS -X POST "$SUPABASE_URL/functions/v1/generate-summary" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$BODY")"

printf '%s' "$RESPONSE" | node -e '
let s = "";
process.stdin.on("data", d => s += d).on("end", () => {
  const body = JSON.parse(s);
  if (!body.descriptions || typeof body.descriptions !== "object" ||
      typeof body.mode !== "string" || typeof body.latency_ms !== "number") {
    throw new Error("Unexpected generate-summary response shape");
  }
  for (const [form, description] of Object.entries(body.descriptions)) {
    if (typeof description !== "string" || !description.trim() || description.length > 600) {
      throw new Error(`Invalid description for ${form}`);
    }
  }
  console.log(JSON.stringify(body, null, 2));
});'
