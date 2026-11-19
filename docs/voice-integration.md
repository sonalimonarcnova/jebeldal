# Voice pipeline on Eng B's backend

How `process-incident-turn` and the app's voice helpers work on top of the incident persistence layer from
`20261118110044_engineer_b_incident_persistence_security.sql` and `20261118202111_phase1_profile_and_answer_validation.sql`.

**In one paragraph:** the app uploads a recording (or sends typed text) and calls `process-incident-turn`. The
function transcribes it, proposes values for the fields of the report's **triggered forms**, and returns them
split into `applied` (confident, explicitly stated) and `suggested`. **The function never writes answers.** The app
shows the proposals; when the driver accepts, the app saves them with `save_incident_answer`. Every write goes
through Eng B's RPCs with the driver's JWT. Tables are read-only to `authenticated`.

```
record / type
   │
   ├─ audio: uploadEvidence()  ── rpc create_incident_evidence → Storage upload → rpc finalize_incident_evidence
   │
   ▼
processTurn()  ──►  process-incident-turn
                     ├─ read revision, triggered forms, form_definitions → extraction catalog
                     ├─ rpc begin_incident_turn          (start + idempotency on client_turn_id)
                     ├─ rpc record_incident_turn_result  (processing)
                     ├─ STT (audio) → extraction → validation
                     └─ rpc record_incident_turn_result  (completed | failed)
   │
   ▼
driver confirms  ──►  saveAcceptedProposals()  ── rpc save_incident_answer × N (sequential, versioned)
```

## 1. `POST /functions/v1/process-incident-turn`

JWT required (the driver's session). Exactly one of `text` or `audio_evidence_id`.

```jsonc
// request
{
  "incident_revision_id": "uuid",
  "client_turn_id": "uuid",            // one per spoken/typed answer; reuse it on retry
  "question_key": "what_happened",     // "form_key.field_key" or a bare field key (auto form preferred)
  "audio_evidence_id": "uuid",         // an evidence row in upload_status 'uploaded'
  "text": "…"                          // ≤ 12 000 chars (begin_incident_turn limit)
}
```

```jsonc
// 200
{
  "turn_id": "uuid",
  "status": "completed",
  "transcript": "A silver sedan cut in front of me … Front bumper is bent.",
  "applied": [
    { "form_key": "auto", "field_key": "property_damaged", "value": true,  "confidence": 0.9,
      "evidence_quote": "my trailer clipped the fence of the gas station" },
    { "form_key": "auto", "field_key": "what_happened",    "value": "A silver sedan cut in …", "confidence": 1,
      "evidence_quote": "A silver sedan cut in …" }
  ],
  "suggested": [],
  "latency_ms": { "stt": 0, "llm": 2669 },
  "mode": "xai"                        // mock | groq | xai | live
}
```

`value` types follow the field definition: `text` / `long_text` / `phone` / `email` → string, `enum` → string,
`multi_enum` → string[], `boolean` → `true` / `false` (real JSON booleans, as `save_incident_answer` expects).

```jsonc
// error
{ "code": "PROVIDER_UNAVAILABLE" | "VALIDATION_FAILED" | "NOT_ALLOWED" | "INCIDENT_NOT_DRAFT",
  "message": "driver-safe text", "retryable": true }
```

| Situation | HTTP | code | retryable |
|---|---|---|---|
| no / bad JWT, not the reporter's revision | 401 / 403 | `NOT_ALLOWED` | no |
| revision submitted | 409 | `INCIDENT_NOT_DRAFT` | no |
| bad body, unknown `question_key`, recording not uploaded / not audio / too small, no words heard | 400 | `VALIDATION_FAILED` | no |
| same `client_turn_id` with different input (`TURN_ID_REUSED`) | 400 | `VALIDATION_FAILED` | no |
| turn still processing (< 60 s) | 409 | `PROVIDER_UNAVAILABLE` | yes |
| STT / LLM down, timeout (20 s each), 429, 5xx; DB/RPC failure | 503 | `PROVIDER_UNAVAILABLE` | yes |
| provider auth error (401 / 403) or missing keys | 503 | `PROVIDER_UNAVAILABLE` | no |

**Idempotency.** `begin_incident_turn` keys turns on `(incident_revision_id, client_turn_id)` and an md5 of the
input. A completed turn returns the **byte-identical** first response, even after the report is submitted. A failed
turn can be retried with the same `client_turn_id`.

### How `applied` vs `suggested` is decided

All of these happen in `validate.ts`; the model never decides what gets saved.

1. The `(form_key, field_key)` must exist in the catalog and the value must fit the field type
   (options, `true`/`false`, `multi_enum` subset, `validation.maxLength`). Otherwise it is rejected.
2. `evidence_quote` must appear in the transcript (case/whitespace-insensitive). Separate parts may be joined
   with ` … `; every part must appear. Otherwise rejected.
3. The model marks each value `stated: true|false`. **Inferred values (`stated: false`) are capped at confidence
   0.6**, so they can only be suggested.
4. Free-text values with more than 2× the words of their quote are only suggested.
5. Confidence ≥ 0.8 → `applied`; otherwise `suggested`.
6. The current question, if it's the story field, always gets the full transcript (models shorten it otherwise).
   Another free-text current question gets the transcript if nothing was applied for it.

Rejected proposals, the catalog's form list and any stub fallback are stored with the turn
(`conversation_turns.extraction_proposals`), never logged.

### The extraction catalog

Built per request from `incident_revision_forms` (`activation_status = 'triggered'`) joined to their
`form_definitions` version. Fields are walked through `fields` / `sections` like `private.definition_fields()`.

| Definition type | Proposed as |
|---|---|
| `boolean` | enum `["true","false"]` → returned as JSON boolean |
| `enum` / `multi_enum` | the option `value`s (labels go into the prompt) |
| `text`, `long_text`, `phone`, `email` | free text (respects `validation.maxLength`) |
| `number`, `currency`, `date`, `address`, `media`, `repeated_group` (+ children) | skipped and logged |

Prompt text comes from `question` → `prompt` → `label` → the humanised key; the description from `description` or
`help`. A field with `narrative: true` is the driver's story; until definitions carry that flag, `what_happened` is
treated as narrative.

The catalog follows the triggers: once `property_damaged = true` is saved, `general_liability` becomes triggered and
the next turn can propose `general_liability.claim_details`.

**Fallback:** if a triggered form's definition has no usable fields, the old stub catalog
(`process-incident-turn/catalog.ts`) is used for that form and a `catalog_degraded` log line is written. Stub fields
are **not** in the definition, so `save_incident_answer` will refuse them. The fallback keeps extraction useful
but those answers cannot be saved.

## 2. RPCs used

| RPC | Called by | Purpose |
|---|---|---|
| `create_incident_draft()` | app (`createDraft`) | new revision; computes the triggered forms |
| `create_incident_evidence(revision, media_type, size_bytes, description)` | app (`uploadEvidence`) | evidence row + server-chosen path `{org}/{revision}/{evidence}` (no extension) |
| `finalize_incident_evidence(evidence_id)` | app | server checks Storage size == declared size and the MIME type; marks `uploaded` or `failed` |
| `begin_incident_turn(revision, client_turn_id, text, audio_evidence_id, language)` | function | creates / returns the turn; bumps the revision version |
| `record_incident_turn_result(revision, turn, status, transcript, proposals, error_code)` | function | `processing` → `completed` (needs a transcript) or `failed`; a completed turn can't be overwritten |
| `save_incident_answer(revision, expected_version, form, field, group, value, state, source, evidence)` | app (`saveAcceptedProposals`) | validates the value against the field definition, upserts the answer, bumps the version, recomputes triggered forms |

Errors come back as Postgres `P0001` with the reason in `message` (`NOT_ALLOWED`, `INCIDENT_NOT_DRAFT`,
`STALE_VERSION`, `VALIDATION_FAILED`, `FORM_DEFINITION_MISSING`, `TURN_ID_REUSED`, `AUTH_REQUIRED`).

## 3. How the app uses it

All in `apps/mobile/src/lib/`:

- **`uploadEvidence({ revisionId, uri, mediaType, questionKey?, evidenceId? })`** (`evidence.ts`) reads the file with
  `expo-file-system` and checks it before anything is created: it must exist, be ≥ 1 KB, and have an m4a `ftyp` or
  JPEG header. Then it calls `create_incident_evidence`, uploads the exact bytes (`audio/mp4` or `image/jpeg`),
  checks the stored size with `storage.info()`, and calls `finalize_incident_evidence`. A failure throws
  `EvidenceUploadError { code, evidenceId, retryable }`. Pass `evidenceId` back to retry on the same row and path.
- **`processTurn(input)`** (`api.ts`) calls the function. Returns `{ ok: true, data }` or
  `{ ok: false, code, retryable, message }` (contract codes plus `NETWORK` / `BAD_RESPONSE`). Responses are
  zod-validated.
- **`saveAcceptedProposals(revisionId, proposals)`** (`api.ts`, logic in `saveProposals.ts`) saves the proposals
  the driver accepted:
  - It reads `incident_revisions.version` once, then calls `save_incident_answer` for each proposal **in order**,
    passing the version returned by the previous call (`answer_state 'confirmed'`, `source 'driver_confirmed'`).
  - `begin_incident_turn` and the evidence RPCs also bump the version. So on `STALE_VERSION` it re-reads the
    version and retries that save **once**.
  - It returns `{ ok: true, data: { saved, version } }` or
    `{ ok: false, code, retryable, message, saved, failed }`. `saved` lists what is already durable.
  - Repeating a save is harmless (it's an upsert).

**UI guidance (D-25).** Never save `suggested` without a tap: pre-select it with a "from your story" badge. `applied`
can skip its question in the interview, but the driver still confirms everything on Review.

**Dev screen.** `app/dev/voice.tsx` is a hidden route, not linked from the UI, and redirects in release builds. Open it
at `jebeldal://dev/voice` (or `/dev/voice` on Expo web) after signing in. It records, uploads, calls `processTurn`,
shows transcript, proposals and timings, and has a **Save applied answers** button that calls
`saveAcceptedProposals`.

## 4. Configuration

`supabase/functions/.env` (gitignored; locally loaded with
`npx supabase functions serve --env-file supabase/functions/.env`; hosted via `supabase secrets set`):

| Variable | Needed for | Notes |
|---|---|---|
| `PROVIDER_MODE` | all | `xai` (org default) · `groq` · `live` (Groq STT + OpenAI) · anything else = `mock` |
| `XAI_API_KEY` | `xai` | starts with `xai-` |
| `XAI_EXTRACT_MODEL` | optional | default `grok-4.20-0309-non-reasoning` (fastest with strict structured output, ~1–3 s) |
| `GROQ_API_KEY`, `GROQ_EXTRACT_MODEL` | `groq`, `live` | Groq keys start with `gsk_` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | `live` | |
| `MOCK_TRANSCRIPT` | `mock` audio | default: Scenario B |

A mode whose keys are missing fails with `PROVIDER_UNAVAILABLE` (`config_missing`). It never silently falls back to
mock. The function logs only ids, status, latency, mode and provider error type/code — never transcripts, audio,
payloads or keys.

xAI STT: `POST https://api.x.ai/v1/stt`, model `grok-voice-transcribe-2.0`, option fields before the file,
`format=true` for English. xAI extraction: chat completions with strict `json_schema`, temperature 0, and a
remembered fallback to `json_object` if a model rejects the schema.

**Local ports changed** with Eng B's `config.toml`: API `http://127.0.0.1:55421`, Studio `:55423`, DB `:55422`.
A phone on Wi-Fi needs `EXPO_PUBLIC_SUPABASE_URL=http://<laptop LAN IP>:55421`.

## 5. Tests

```
node scripts/test-voice.mjs                     # function: validation, catalog, providers, audio, mock (60)
npm --prefix apps/mobile test                   # Eng B's phase-1 tests + saveProposals (17)
npm run mobile:typecheck
powershell -File scripts/curl/process-incident-turn.ps1   # text turn + idempotent replay against local
```

## 6. Known gaps

- **Placeholder form definitions.** `auto` has only `what_happened` (long_text) and five booleans
  (`property_damaged`, `delivery_work`, `injuries`, `other_vehicle`, `police`). GL and WC have one long-text field
  each. There are no labels, options or descriptions, so prompts use humanised keys. Most of what a driver says
  (truck damage zones, weather, police report number, witnesses, place type) has **no field to land in**; it stays in
  `what_happened`. Extraction quality will improve as soon as the real 38-question definitions are seeded (E1).
- **Narrative flag.** Definitions don't mark the story field; `what_happened` is hard-coded as narrative in
  `form_catalog.ts` until a `narrative: true` property exists.
- **No provenance on answers.** `save_incident_answer` accepts only `source` `manual | driver_confirmed` and has no
  confidence / evidence-quote / turn parameters. Voice answers are stored as `driver_confirmed` without a link to
  their turn. The evidence quote lives only in the turn's stored proposals.
- **No tap/typed protection.** The previous pipeline never overwrote tap/typed/edited answers. With only `manual` /
  `driver_confirmed` sources, the app has to decide: don't call `saveAcceptedProposals` for fields the driver already
  answered.
- **Repeated groups** (other vehicles, witnesses, injured people) are skipped: answers need a `group_instance_id`
  from `create_incident_answer_group`, which voice doesn't drive yet.
- **Stub fallback answers can't be saved** (fields not in the definition → `VALIDATION_FAILED`).
- **Language:** `begin_incident_turn` accepts `en` / `es` only; STT formatting is enabled for English.
