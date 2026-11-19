import { corsHeaders } from '../_shared/cors.ts';
import {
  authenticateRequest,
  backendErrorResponse,
  errorResponse,
  jsonResponse,
  readJsonResponse,
} from '../_shared/backend.ts';
import { incidentTurnSchema } from '../_shared/schema.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED');
  }

  const backend = await authenticateRequest(req);
  if (backend instanceof Response) return backend;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED');
  }
  const parsed = incidentTurnSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', {
      issues: parsed.error.flatten(),
    });
  }

  try {
    const beginResponse = await fetch(
      `${backend.url}/rest/v1/rpc/begin_incident_turn`,
      {
        method: 'POST',
        headers: backend.headers,
        body: JSON.stringify({
          p_incident_revision_id: parsed.data.incident_revision_id,
          p_client_turn_id: parsed.data.client_turn_id,
          p_text: parsed.data.text ?? null,
          p_audio_evidence_id: parsed.data.audio_evidence_id ?? null,
          p_language: 'en',
        }),
      },
    );
    const begin = await readJsonResponse(beginResponse);
    if (!begin.ok) return backendErrorResponse(begin.body);

    if (
      !begin.body || typeof begin.body !== 'object' || Array.isArray(begin.body)
    ) {
      return errorResponse('INTERNAL_ERROR');
    }
    const turn = begin.body as Record<string, unknown>;
    if (typeof turn.turn_id !== 'string') {
      return errorResponse('INTERNAL_ERROR');
    }
    if (turn.status === 'completed') {
      return jsonResponse(turn);
    }

    if (parsed.data.audio_evidence_id) {
      const failedResponse = await fetch(
        `${backend.url}/rest/v1/rpc/record_incident_turn_result`,
        {
          method: 'POST',
          headers: backend.headers,
          body: JSON.stringify({
            p_incident_revision_id: parsed.data.incident_revision_id,
            p_turn_id: turn.turn_id,
            p_status: 'failed',
            p_proposals: [],
            p_error_code: 'PROVIDER_UNAVAILABLE',
          }),
        },
      );
      const failed = await readJsonResponse(failedResponse);
      if (!failed.ok) return backendErrorResponse(failed.body);
      return errorResponse('PROVIDER_UNAVAILABLE', {
        message:
          'Audio transcription is unavailable. Use text input now; this turn is saved for retry.',
        turn: failed.body,
      });
    }

    const completedResponse = await fetch(
      `${backend.url}/rest/v1/rpc/record_incident_turn_result`,
      {
        method: 'POST',
        headers: backend.headers,
        body: JSON.stringify({
          p_incident_revision_id: parsed.data.incident_revision_id,
          p_turn_id: turn.turn_id,
          p_status: 'completed',
          p_transcript: parsed.data.text,
          p_proposals: [],
        }),
      },
    );
    const completed = await readJsonResponse(completedResponse);
    if (!completed.ok) return backendErrorResponse(completed.body);
    return jsonResponse(completed.body);
  } catch {
    return errorResponse('RETRYABLE_FAILURE');
  }
});
