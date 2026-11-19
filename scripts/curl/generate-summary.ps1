# Smoke test for generate-summary against a running local Supabase project.
# Prereqs: npx supabase start; node scripts/seed-hosted-dev-accounts.mjs;
#          npx supabase functions serve --env-file supabase/functions/.env
# Usage:   powershell -ExecutionPolicy Bypass -File scripts/curl/generate-summary.ps1
# Optional env overrides: SUPABASE_URL, SUPABASE_ANON_KEY, DEV_EMAIL, DEV_PASSWORD
$ErrorActionPreference = 'Stop'

$api = $env:SUPABASE_URL
$publishableKey = $env:SUPABASE_ANON_KEY
if (-not $api -or -not $publishableKey) {
  $status = @{}
  $ErrorActionPreference = 'Continue'
  npx supabase status -o env 2>$null | ForEach-Object {
    if ("$_" -match '^([A-Z_]+)="?(.*?)"?$') { $status[$matches[1]] = $matches[2] }
  }
  $ErrorActionPreference = 'Stop'
  if (-not $api) { $api = $status.API_URL }
  if (-not $publishableKey) {
    $publishableKey = if ($status.PUBLISHABLE_KEY) { $status.PUBLISHABLE_KEY } else { $status.ANON_KEY }
  }
}
if (-not $api -or -not $publishableKey) {
  throw 'Local Supabase is not running (npx supabase start).'
}
$api = $api.TrimEnd('/')

$email = if ($env:DEV_EMAIL) { $env:DEV_EMAIL } else { 'driver+dev1@jebel.local' }
$password = if ($env:DEV_PASSWORD) { $env:DEV_PASSWORD } else { 'DevDriver#101' }

function Invoke-Json($Method, $Uri, $Headers, $Body = $null) {
  $request = @{
    Method      = $Method
    Uri         = $Uri
    Headers     = $Headers
    ErrorAction = 'Stop'
  }
  if ($null -ne $Body) {
    $request.ContentType = 'application/json'
    $request.Body = ConvertTo-Json -InputObject $Body -Depth 20 -Compress
  }
  try {
    $response = Invoke-RestMethod @request
    return @{
      status = 200
      data   = $response
      body   = $null
    }
  } catch {
    $httpResponse = $_.Exception.Response
    if (-not $httpResponse) { throw }
    $responseBody = $_.ErrorDetails.Message
    if (-not $responseBody) {
      $reader = [System.IO.StreamReader]::new($httpResponse.GetResponseStream())
      try { $responseBody = $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
    return @{ status = [int]$httpResponse.StatusCode; data = $null; body = $responseBody }
  }
}

Write-Host "1. Sign in as $email"
$login = Invoke-Json Post "$api/auth/v1/token?grant_type=password" @{ apikey = $publishableKey } @{
  email    = $email
  password = $password
}
if ($login.status -ne 200) { throw "Sign-in failed ($($login.status))" }
$token = $login.data.access_token
$auth = @{ apikey = $publishableKey; Authorization = "Bearer $token" }

Write-Host '2. Complete driver profile (idempotent)'
$profile = Invoke-Json Post "$api/rest/v1/rpc/complete_driver_profile" $auth @{}
if ($profile.status -ne 200) {
  throw "complete_driver_profile failed ($($profile.status)): $($profile.body)"
}

Write-Host '3. Create draft'
$draft = Invoke-Json Post "$api/rest/v1/rpc/create_incident_draft" $auth @{}
if ($draft.status -ne 200) {
  throw "create_incident_draft failed ($($draft.status)): $($draft.body)"
}
$revisionId = [string]$draft.data
Write-Host "   revision: $revisionId"

$scenarioB = "A silver sedan cut in front of me from the right lane on I-35 north near exit 235 and braked hard. I couldn't stop, hit the back of it at low speed and my trailer clipped the fence of the gas station. Police came. Nobody was hurt. Front bumper is bent."
$turn = Invoke-Json Post "$api/functions/v1/process-incident-turn" $auth @{
  incident_revision_id = $revisionId
  client_turn_id       = [guid]::NewGuid().ToString()
  question_key         = 'what_happened'
  text                 = $scenarioB
}
if ($turn.status -ne 200) {
  throw "process-incident-turn failed ($($turn.status)): $($turn.body)"
}
$turnBody = $turn.data
Write-Host "4. process-incident-turn returned $(@($turnBody.applied).Count) applied proposals"

$versionResult = Invoke-Json Get `
  "$api/rest/v1/incident_revisions?select=version&id=eq.$revisionId" `
  $auth
if ($versionResult.status -ne 200) {
  throw "Could not read revision version ($($versionResult.status)): $($versionResult.body)"
}
$revisionRows = @($versionResult.data)
if ($revisionRows.Count -ne 1) { throw 'Expected exactly one visible revision.' }
$expectedVersion = [int]$revisionRows[0].version
Write-Host "   current revision version: $expectedVersion"

foreach ($proposal in @($turnBody.applied | Where-Object { $_ })) {
  $answer = Invoke-Json Post "$api/rest/v1/rpc/save_incident_answer" $auth @{
    p_incident_revision_id = $revisionId
    p_expected_version     = $expectedVersion
    p_form_key             = $proposal.form_key
    p_field_key            = $proposal.field_key
    p_group_instance_id    = $null
    p_value                = $proposal.value
    p_answer_state         = 'confirmed'
    p_source               = 'driver_confirmed'
    p_evidence_id          = $null
  }
  if ($answer.status -ne 200) {
    throw "save_incident_answer failed for $($proposal.form_key).$($proposal.field_key) at version $expectedVersion ($($answer.status)): $($answer.body)"
  }
  $expectedVersion = [int]$answer.data
}

Write-Host '5. Generate descriptions'
$summary = Invoke-Json Post "$api/functions/v1/generate-summary" $auth @{
  incident_revision_id = $revisionId
}
if ($summary.status -ne 200) {
  throw "generate-summary failed ($($summary.status)): $($summary.body)"
}
$summaryBody = $summary.data
Write-Host "   mode: $($summaryBody.mode); latency: $($summaryBody.latency_ms) ms"
$summaryBody.descriptions | ConvertTo-Json -Depth 10
