# Smoke test for process-incident-turn (text mode, Scenario B) against LOCAL Supabase.
# Prereqs: npx supabase start; node scripts/seed-hosted-dev-accounts.mjs (local env);
#          npx supabase functions serve --env-file supabase/functions/.env
# Usage:   powershell -ExecutionPolicy Bypass -File scripts/curl/process-incident-turn.ps1
# Optional env overrides: SUPABASE_URL, SUPABASE_ANON_KEY, DEV_EMAIL, DEV_PASSWORD
$ErrorActionPreference = 'Stop'

$api = $env:SUPABASE_URL
$anon = $env:SUPABASE_ANON_KEY
if (-not $api -or -not $anon) {
  $status = @{}
  # The CLI writes notices to stderr; in Windows PowerShell 5.1 that is a terminating error under 'Stop'.
  $ErrorActionPreference = 'Continue'
  npx supabase status -o env 2>$null | ForEach-Object { if ("$_" -match '^([A-Z_]+)="?(.*?)"?$') { $status[$matches[1]] = $matches[2] } }
  $ErrorActionPreference = 'Stop'
  if (-not $api) { $api = $status.API_URL }
  if (-not $anon) { $anon = if ($status.PUBLISHABLE_KEY) { $status.PUBLISHABLE_KEY } else { $status.ANON_KEY } }
}
if (-not $api -or -not $anon) { throw 'Local Supabase is not running (npx supabase start).' }

$email = if ($env:DEV_EMAIL) { $env:DEV_EMAIL } else { 'driver+dev1@jebel.local' }
$password = if ($env:DEV_PASSWORD) { $env:DEV_PASSWORD } else { 'DevDriver#101' }

function Invoke-Json($Method, $Uri, $Headers, $Body) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Method $Method -Uri $Uri -Headers $Headers -ContentType 'application/json' `
      -Body ([System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10 -Compress)))
    return @{ status = [int]$resp.StatusCode; body = [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) }
  } catch {
    $r = $_.Exception.Response
    if (-not $r) { throw }
    return @{ status = [int]$r.StatusCode; body = $_.ErrorDetails.Message }
  }
}

Write-Host "1. Sign in as $email"
$login = Invoke-Json Post "$api/auth/v1/token?grant_type=password" @{ apikey = $anon } @{ email = $email; password = $password }
if ($login.status -ne 200) { throw "Sign-in failed ($($login.status))" }
$token = ($login.body | ConvertFrom-Json).access_token
$auth = @{ apikey = $anon; Authorization = "Bearer $token" }

Write-Host '2. Create draft (rpc create_incident_draft)'
$draft = Invoke-Json Post "$api/rest/v1/rpc/create_incident_draft" $auth @{}
if ($draft.status -ne 200) { throw "create_incident_draft failed ($($draft.status)): $($draft.body)" }
$revisionId = $draft.body | ConvertFrom-Json
Write-Host "   revision: $revisionId"

$body = @{
  incident_revision_id = $revisionId
  client_turn_id       = [guid]::NewGuid().ToString()
  question_key         = 'what_happened'
  text                 = "A silver sedan cut in front of me from the right lane on I-35 north near exit 235 and braked hard. I couldn't stop, hit the back of it at low speed and my trailer clipped the fence of the gas station. Police came. Nobody was hurt. Front bumper is bent."
}

Write-Host '3. process-incident-turn (text, Scenario B)'
$first = Invoke-Json Post "$api/functions/v1/process-incident-turn" $auth $body
Write-Host "   HTTP $($first.status)"
$first.body | ConvertFrom-Json | ConvertTo-Json -Depth 10

Write-Host "`n4. Same client_turn_id again (idempotency)"
$second = Invoke-Json Post "$api/functions/v1/process-incident-turn" $auth $body
Write-Host "   HTTP $($second.status)"
$second.body | ConvertFrom-Json | ConvertTo-Json -Depth 10

$same = ($first.body | ConvertFrom-Json | ConvertTo-Json -Depth 10 -Compress) -eq ($second.body | ConvertFrom-Json | ConvertTo-Json -Depth 10 -Compress)
Write-Host "`nIdentical responses: $same"
$applied = (($first.body | ConvertFrom-Json).applied | ForEach-Object { "$($_.form_key).$($_.field_key)" }) -join ', '
Write-Host "Applied keys: $applied"
if (-not $same -or $first.status -ne 200) { exit 1 }
