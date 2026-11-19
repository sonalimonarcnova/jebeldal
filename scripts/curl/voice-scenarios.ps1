$ErrorActionPreference = 'Continue'
$st = @{}; npx supabase status -o env 2>$null | ForEach-Object { if ("$_" -match '^([A-Z_]+)="?(.*?)"?$') { $st[$matches[1]] = $matches[2] } }
$api = $st.API_URL; $anon = $st.PUBLISHABLE_KEY

function Post($uri, $headers, $body) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $uri -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress -Depth 10)))
    @{ s = [int]$r.StatusCode; b = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) }
  } catch { @{ s = [int]$_.Exception.Response.StatusCode; b = $_.ErrorDetails.Message } }
}

$login = (Post "$api/auth/v1/token?grant_type=password" @{ apikey = $anon } @{ email = 'driver+dev1@jebel.local'; password = 'DevDriver#101' }).b | ConvertFrom-Json
$h = @{ apikey = $anon; Authorization = "Bearer $($login.access_token)" }

# Texts are the constants SCENARIO_A/B/C_TEXT in supabase/functions/process-incident-turn/providers.ts
$scenarios = [ordered]@{
  'A (bollard, our yard)' = 'I was reversing into door 4 in our yard and the trailer backed into a yellow bollard. The rear bumper is dented. Nobody was hurt and there were no police.'
  'B (sedan + fence, I-35)' = "A silver sedan cut in front of me from the right lane on I-35 north near exit 235 and braked hard. I couldn't stop, hit the back of it at low speed and my trailer clipped the fence of the gas station. Police came. Nobody was hurt. Front bumper is bent."
  'C (pallet, customer dock)' = "I was unloading a delivery at the customer's dock when a pallet slid off the jack and hurt my foot. It was just my truck, and the truck is fine."
}

foreach ($name in $scenarios.Keys) {
  $rev = (Post "$api/rest/v1/rpc/create_incident_draft" $h @{}).b | ConvertFrom-Json
  $r = Post "$api/functions/v1/process-incident-turn" $h @{ incident_revision_id = $rev; client_turn_id = [guid]::NewGuid().ToString(); question_key = 'what_happened'; text = $scenarios[$name] }
  "=== Scenario $name   HTTP $($r.s)"
  if ($r.s -ne 200) { "   $($r.b)"; continue }
  $j = $r.b | ConvertFrom-Json
  "   mode=$($j.mode)  llm=$($j.latency_ms.llm) ms"
  foreach ($a in $j.applied) {
    $v = if ($a.value -is [array]) { $a.value -join ', ' } else { "$($a.value)" }
    if ($a.key -eq 'what_happened') { $v = '(full transcript)' }
    "   applied   {0,-17} {1,-45} {2:0.00}  ""{3}""" -f $a.key, $v, $a.confidence, $a.evidence_quote
  }
  foreach ($s in $j.suggested) {
    $v = if ($s.value -is [array]) { $s.value -join ', ' } else { "$($s.value)" }
    "   suggested {0,-17} {1,-45} {2:0.00}  ""{3}""" -f $s.key, $v, $s.confidence, $s.evidence_quote
  }
}
