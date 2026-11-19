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

JWT required (the driver's session). Exactly one of `text` or `audio_evidence_id`. The function uses the team's
`_shared/backend.ts` helpers (`authenticateRequest`, `readJsonResponse`, `errorResponse`) and their error envelope.

```jsonc
// request
{
  "incident_revision_id": "uuid",
  "client_turn_id": "…",               // one per spoken/typed answer; reuse it on retry
  "form_key": "auto",                  // optional: the pinned question from select-next-question …
  "field_key": "what_happened",        // … (send both or neither)
  "question_key": "what_happened",     // optional alternative: "form_key.field_key" or a bare field key
  "audio_evidence_id": "uuid",         // an evidence row in upload_status 'uploaded'
  "text": "…"                          // ≤ 12 000 chars (begin_incident_turn limit)
}
```

The current question is optional: without it everything in the catalog is still extracted, but the story field
only gets the full transcript when it is the current question. When given, it is listed first in the prompt.

```jsonc
// 200 — a superset of what questionFlow.ts parseProcessedTurnResponse reads (turn_id, status)
{
  "turn_id": "uuid",
  "client_turn_id": "…",
  "status": "completed",
  "transcript": "A silver sedan cut in front of me … Front bumper is bent.",
  "applied": [
    { "form_key": "auto", "field_key": "involved", "value": ["another_vehicle", "object"], "confidence": 0.9,
      "evidence_quote": "A silver sedan cut in front of me … my trailer clipped the fence" },
    { "form_key": "auto", "field_key": "what_happened", "value": "A silver sedan cut in …", "confidence": 1,
      "evidence_quote": "A silver sedan cut in …" }
  ],
  "suggested": [
    { "form_key": "auto", "field_key": "weather_road", "value": ["clear"], "confidence": 0.4, "evidence_quote": "…" }
  ],
  "latency_ms": { "stt": 0, "llm": 2434 },
  "mode": "xai"                        // mock | groq | xai | live
}
```

`value` types follow the field definition and use its **exact option values** (e.g. `our_yard_or_terminal`,
`yes_i_can_drive_it`, `none`): `text` / `long_text` / `phone` / `email` → string, `enum` → string,
`multi_enum` → string[], `boolean` → `true` / `false` (JSON booleans, as `save_incident_answer` expects).

```jsonc
// error — _shared/backend.ts envelope (status comes from the code)
{ "code": "VALIDATION_FAILED", "message": "driver-safe text", "retryable": false }
```

| Situation | HTTP | code | retryable |
|---|---|---|---|
| no / bad JWT | 401 | `AUTH_REQUIRED` | no |
| not the reporter's revision / evidence | 403 | `NOT_ALLOWED` | no |
| revision submitted | 409 | `INCIDENT_NOT_DRAFT` | no |
| same `client_turn_id` with different input | 409 | `TURN_ID_REUSED` | no |
| bad body, no triggered forms, recording not uploaded / not audio / too small, no words heard | 400 | `VALIDATION_FAILED` | no |
| STT / LLM down, timeout (20 s each), 429, 5xx | 503 | `PROVIDER_UNAVAILABLE` | yes |
| provider auth error (401 / 403) or missing keys | 503 | `PROVIDER_UNAVAILABLE` | no |
| turn still processing (< 60 s), storage / DB / RPC hiccup | 503 | `RETRYABLE_FAILURE` | yes |
| unexpected error | 500 | `INTERNAL_ERROR` | yes |

The app's `processTurn` accepts all of these and fills in a message / retryable default when the body has only
`{ code }` (as `backendErrorResponse` sends).

**Profile completion.** `create_incident_draft` raises `PROFILE_INCOMPLETE` until the driver has confirmed their
profile (`rpc complete_driver_profile`). The curl scripts call it first.

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

Built per request from the **interview graph** (`form_sets.definition.interview_graph`, 38 nodes), not from all
~160 definition fields. That keeps the prompt to about 26 entries (≈ 2.5 s with Grok) and matches exactly what
`select-next-question` asks.

1. Load the revision's **triggered** forms (`incident_revision_forms.activation_status = 'triggered'`) and their
   pinned `form_definitions` versions.
2. Run the team's own `prepareInterviewGraph()` (`_shared/interview.mjs`) to pin each node to a single scalar field
   via `forms_source` → `form_key_map`. Nodes in untriggered forms, or that match ambiguously, are left out.
3. Turn each pinned field into an entry keyed `form_key.field_key`. The prompt is the node's question text, the form
   label goes into the description, and options are the definition's own `value`s with labels as meanings.

| Definition type | Proposed as |
|---|---|
| `boolean` | enum `["true","false"]` → returned as JSON boolean |
| `enum` / `multi_enum` | the definition's option `value`s (labels go into the prompt) |
| `text`, `long_text`, `phone`, `email` | free text (respects `validation.maxLength`) |
| `number`, `currency`, `date`, `address`, `media` | skipped (`catalog_skipped` log) |
| a node that maps to a section heading (e.g. GL `property_damaged`) | skipped (`not_a_scalar_field`) |
| a node whose field exists only inside a `repeated_group` | skipped and logged as `repeated_group_fields` |

**Story field:** a field with `narrative: true`, otherwise the graph's first node whose question reads "What
happened?" with a text field (today `auto.what_happened`). No key is hard-coded.

The catalog follows the triggers. Saving `involved = ["another_vehicle", "object"]` triggers `general_liability`, and
the next turn can propose `general_liability.place_type` / `property_owner`.

**Fallbacks** (logged as `catalog_fallback`):
- No interview graph, or no node pinned: every supported scalar field of the triggered forms is used.
- A form with no usable fields at all: the old stub catalog (`catalog.ts`) is used for it. Stub fields are not in
  the definition, so `save_incident_answer` refuses them.

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
node scripts/test-voice.mjs                     # function: validation, graph catalog (real seed.sql), providers, audio, mock (69)
npm --prefix apps/mobile test                   # team's mobile tests + saveProposals (34)
node --test supabase/tests/interview-graph-seed.test.mjs supabase/tests/interview-planner.test.mjs   # team (18)
npm run mobile:typecheck
powershell -File scripts/curl/process-incident-turn.ps1   # text turn + idempotent replay against local
```

## 6. Known gaps

- **Graph nodes that pin to nothing.** Some nodes map to a section heading (GL `property_damaged`) or only exist in
  another form (e.g. `delivery_work` is in `auto` but the graph says GL), so voice can't fill them. Fixing the
  graph's `forms_source` or the definitions fixes both voice and the planner.
- **Narrative flag.** No definition marks the story field yet; it is found from the "What happened?" question text.
  Adding `narrative: true` to the field would make that explicit.
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
