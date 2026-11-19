$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$local = npx --yes supabase@3.2.0 status -o env | ConvertFrom-StringData
$supabaseUrl = $local.API_URL.Trim([char]34)
$publishableKey = $local.ANON_KEY.Trim([char]34)

$session = Invoke-RestMethod `
  -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
  -Method Post `
  -Headers @{ apikey = $publishableKey } `
  -ContentType 'application/json' `
  -Body (@{
    email = 'driver+dev1@jebel.local'
    password = 'DevDriver#101'
  } | ConvertTo-Json -Compress)

$headers = @{
  apikey = $publishableKey
  Authorization = "Bearer $($session.access_token)"
}

$revisionId = [string](Invoke-RestMethod `
  -Uri "$supabaseUrl/rest/v1/rpc/create_incident_draft" `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body '{"p_form_set_key":"default","p_form_set_version":1,"p_language":"en"}')

$answers = @(
  @{ key = 'what_happened'; value = 'Fictional local API smoke test' },
  @{ key = 'property_damaged'; value = $false },
  @{ key = 'delivery_work'; value = $false },
  @{ key = 'injuries'; value = $false },
  @{ key = 'other_vehicle'; value = $false },
  @{ key = 'police'; value = $false }
)

$version = 1
foreach ($answer in $answers) {
  $payload = @{
    p_incident_revision_id = $revisionId
    p_expected_version = $version
    p_form_key = 'auto'
    p_field_key = $answer.key
    p_group_instance_id = $null
    p_value = $answer.value
    p_answer_state = 'confirmed'
    p_source = 'manual'
    p_evidence_id = $null
  } | ConvertTo-Json -Compress

  $version = [int](Invoke-RestMethod `
    -Uri "$supabaseUrl/rest/v1/rpc/save_incident_answer" `
    -Method Post `
    -Headers $headers `
    -ContentType 'application/json' `
    -Body $payload)
}

$requestBody = @{
  incident_revision_id = $revisionId
  expected_version = $version
  signature_reference = [guid]::NewGuid().ToString()
  auth_method = 'device_passcode'
  device_description = 'PowerShell local smoke test'
} | ConvertTo-Json -Compress

$client = New-Object System.Net.Http.HttpClient
$client.DefaultRequestHeaders.Add('apikey', $publishableKey)
$client.DefaultRequestHeaders.Authorization = `
  [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $session.access_token)
$submitUri = "$supabaseUrl/functions/v1/submit-incident"
$contentOne = [System.Net.Http.StringContent]::new(
  $requestBody, [System.Text.Encoding]::UTF8, 'application/json')
$contentTwo = [System.Net.Http.StringContent]::new(
  $requestBody, [System.Text.Encoding]::UTF8, 'application/json')
$taskOne = $client.PostAsync($submitUri, $contentOne)
$taskTwo = $client.PostAsync($submitUri, $contentTwo)
[System.Threading.Tasks.Task]::WaitAll(
  [System.Threading.Tasks.Task[]]@($taskOne, $taskTwo))

$responseOne = $taskOne.Result
$responseTwo = $taskTwo.Result
if (-not $responseOne.IsSuccessStatusCode -or -not $responseTwo.IsSuccessStatusCode) {
  throw 'One of the concurrent submit requests failed.'
}

$submitted = ConvertFrom-Json $responseOne.Content.ReadAsStringAsync().GetAwaiter().GetResult()
$concurrent = ConvertFrom-Json $responseTwo.Content.ReadAsStringAsync().GetAwaiter().GetResult()
$retried = Invoke-RestMethod `
  -Uri $submitUri `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body $requestBody
$client.Dispose()

if ($submitted.status -ne 'submitted' -or
    $concurrent.status -ne 'submitted' -or
    $concurrent.report_reference -ne $submitted.report_reference -or
    $retried.report_reference -ne $submitted.report_reference) {
  throw 'Concurrent submit or idempotent retry did not return the same report reference.'
}

Write-Output "PASS submitted $($submitted.report_reference)"