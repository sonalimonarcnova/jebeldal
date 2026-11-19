$ErrorActionPreference = 'Continue'
$st = @{}; npx supabase status -o env 2>$null | ForEach-Object { if ("$_" -match '^([A-Z_]+)="?(.*?)"?$') { $st[$matches[1]] = $matches[2] } }
$api = $st.API_URL; $anon = $st.PUBLISHABLE_KEY

function Call($Method, $Uri, $Headers, $Body, $ContentType = 'application/json') {
  try {
    [byte[]]$bytes = $null
    if ($Body -is [byte[]]) { $bytes = $Body } else { $bytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10 -Compress)) }
    $r = Invoke-WebRequest -UseBasicParsing -Method $Method -Uri $Uri -Headers $Headers -ContentType $ContentType -Body $bytes
    @{ s = [int]$r.StatusCode; b = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) }
  } catch { @{ s = [int]$_.Exception.Response.StatusCode; b = $_.ErrorDetails.Message } }
}
function Login($email, $pw) {
  $r = Call Post "$api/auth/v1/token?grant_type=password" @{ apikey = $anon } @{ email = $email; password = $pw }
  $t = $r.b | ConvertFrom-Json
  @{ token = $t.access_token; id = $t.user.id; h = @{ apikey = $anon; Authorization = "Bearer $($t.access_token)" } }
}
function Turn($h, $rev, $q, $text, $turnId = [guid]::NewGuid().ToString()) {
  Call Post "$api/functions/v1/process-incident-turn" $h @{ incident_revision_id = $rev; client_turn_id = $turnId; question_key = $q; text = $text }
}
function Show($label, $r) { "{0,-44} HTTP {1}  {2}" -f $label, $r.s, ($r.b.Substring(0, [Math]::Min(170, $r.b.Length))) }

$d1 = Login 'driver+dev1@jebel.local' 'DevDriver#101'
$d2 = Login 'driver+dev2@jebel.local' 'DevDriver#102'
$rev = (Call Post "$api/rest/v1/rpc/create_incident_draft" $d1.h @{}).b | ConvertFrom-Json

# 1. driver 1 taps injuries = me (source tap) before speaking
$tap = Call Post "$api/rest/v1/incident_answers" ($d1.h + @{ Prefer = 'return=minimal' }) @{ incident_revision_id = $rev; form_key = 'interview'; field_key = 'injuries'; value = 'me'; answer_state = 'confirmed'; source = 'tap'; updated_by = $d1.id }
Show 'seed tap answer injuries=me' $tap
$r = Turn $d1.h $rev 'what_happened' 'A silver sedan hit me. Nobody was hurt. Police came.'
Show 'voice says nobody hurt (tap must win)' $r
"   applied keys: " + ((($r.b | ConvertFrom-Json).applied | ForEach-Object key) -join ', ')

# 2. voice_open fallback: police_report_no with no extractable rule
$r = Turn $d1.h $rev 'police_report_no' 'Austin PD, 26-0912-0387'
Show 'voice_open fallback police_report_no' $r

# 3. empty-ish / no match on a choice question
$r = Turn $d1.h $rev 'cargo' 'I am not sure about that one'
Show 'choice question, nothing extracted' $r

# 4. validation errors
Show 'unknown question_key' (Turn $d1.h $rev 'favourite_colour' 'blue')
Show 'missing question_key' (Call Post "$api/functions/v1/process-incident-turn" $d1.h @{ incident_revision_id = $rev; client_turn_id = 'x'; text = 'hi' })
Show 'both text and audio' (Call Post "$api/functions/v1/process-incident-turn" $d1.h @{ incident_revision_id = $rev; client_turn_id = 'x'; question_key = 'police'; text = 'hi'; audio_evidence_id = [guid]::NewGuid().ToString() })

# 5. other driver's revision
Show 'driver 2 on driver 1 revision' (Turn $d2.h $rev 'what_happened' 'Police came.')

# 6. no / bad JWT
Show 'no Authorization header' (Call Post "$api/functions/v1/process-incident-turn" @{ apikey = $anon } @{ incident_revision_id = $rev; client_turn_id = 'x'; question_key = 'police'; text = 'hi' })

# 7. audio mode (mock STT) through storage
$org = '11111111-1111-1111-1111-111111111111'
$evId = [guid]::NewGuid().ToString()
$path = "$org/$rev/$evId.m4a"
$ev = Call Post "$api/rest/v1/evidence" ($d1.h + @{ Prefer = 'return=minimal' }) @{ id = $evId; organization_id = $org; incident_revision_id = $rev; object_path = $path; media_type = 'audio'; upload_status = 'pending'; uploaded_by = $d1.id }
Show 'evidence row (pending)' $ev
Show 'audio before upload -> VALIDATION_FAILED' (Call Post "$api/functions/v1/process-incident-turn" $d1.h @{ incident_revision_id = $rev; client_turn_id = [guid]::NewGuid().ToString(); question_key = 'what_happened'; audio_evidence_id = $evId })
$up = Call Post "$api/storage/v1/object/incident-evidence/$path" $d1.h ([byte[]](0..255)) 'audio/mp4'
Show 'storage upload' $up
$mk = Call Patch "$api/rest/v1/evidence?id=eq.$evId" ($d1.h + @{ Prefer = 'return=minimal' }) @{ upload_status = 'uploaded'; size_bytes = 256 }
Show 'mark uploaded' $mk
$r = Call Post "$api/functions/v1/process-incident-turn" $d1.h @{ incident_revision_id = $rev; client_turn_id = [guid]::NewGuid().ToString(); question_key = 'what_happened'; audio_evidence_id = $evId }
Show 'audio mode (mock STT)' $r
"   applied keys: " + ((($r.b | ConvertFrom-Json).applied | ForEach-Object key) -join ', ')

# 8. submitted revision (service role flips status directly, simulating submit-incident)
$turnId = [guid]::NewGuid().ToString()
$before = Turn $d1.h $rev 'witnesses' 'Luis saw it' $turnId
docker exec supabase_db_jebeldal psql -U postgres -d postgres -qtc "update incident_revisions set status='submitted' where id='$rev';" | Out-Null
Show 'new turn on submitted revision' (Turn $d1.h $rev 'witnesses' 'Luis saw it')
$after = Turn $d1.h $rev 'witnesses' 'Luis saw it' $turnId
"{0,-44} {1}" -f 'replay of completed turn after submit', ($(if ($after.s -eq 200 -and $after.b -eq $before.b) { 'identical 200' } else { "HTTP $($after.s)" }))
"REV=$rev"
