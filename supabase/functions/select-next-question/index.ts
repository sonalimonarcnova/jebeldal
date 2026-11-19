import { corsHeaders } from '../_shared/cors.ts';
import {
  authenticateRequest,
  backendErrorResponse,
  errorResponse,
  jsonResponse,
  readJsonResponse,
} from '../_shared/backend.ts';
import { selectNextQuestionSchema } from '../_shared/schema.ts';
import { selectNextQuestion } from '../_shared/interview.mjs';

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
  const parsed = selectNextQuestionSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', {
      issues: parsed.error.flatten(),
    });
  }

  try {
    const revisionResponse = await fetch(
      `${backend.url}/rest/v1/incident_revisions?select=id,form_set_key,form_set_version,status&id=eq.${parsed.data.incident_revision_id}`,
      { headers: backend.headers },
    );
    const revisionResult = await readJsonResponse(revisionResponse);
    if (!revisionResult.ok) return backendErrorResponse(revisionResult.body);
    const revision = Array.isArray(revisionResult.body)
      ? revisionResult.body[0] as Record<string, unknown> | undefined
      : null;
    if (!revision) return errorResponse('NOT_ALLOWED');
    if (
      typeof revision.form_set_key !== 'string' ||
      typeof revision.form_set_version !== 'number'
    ) {
      return errorResponse('INTERNAL_ERROR');
    }
    if (revision.status !== 'draft') return errorResponse('INCIDENT_NOT_DRAFT');

    const formSetQuery = new URLSearchParams({
      select: 'definition',
      form_set_key: `eq.${revision.form_set_key}`,
      version: `eq.${revision.form_set_version}`,
    });
    const formSetResponse = await fetch(
      `${backend.url}/rest/v1/form_sets?${formSetQuery.toString()}`,
      { headers: backend.headers },
    );
    const formSetResult = await readJsonResponse(formSetResponse);
    if (!formSetResult.ok) return backendErrorResponse(formSetResult.body);
    const formSet = Array.isArray(formSetResult.body)
      ? formSetResult.body[0] as Record<string, unknown> | undefined
      : null;
    const definition = formSet?.definition;
    if (
      !definition || typeof definition !== 'object' || Array.isArray(definition)
    ) {
      return errorResponse('INTERNAL_ERROR');
    }
    const graph = (definition as Record<string, unknown>).interview_graph;
    if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
      return errorResponse('INTERNAL_ERROR');
    }
    const graphRecord = graph as Record<string, unknown>;
    if (
      !Array.isArray(graphRecord.nodes) ||
      !Array.isArray(graphRecord.conditions)
    ) {
      return errorResponse('INTERNAL_ERROR');
    }

    const answersQuery = new URLSearchParams({
      select: 'field_key,value',
      incident_revision_id: `eq.${parsed.data.incident_revision_id}`,
      answer_state: 'eq.confirmed',
      order: 'updated_at.desc',
    });
    const answersResponse = await fetch(
      `${backend.url}/rest/v1/incident_answers?${answersQuery.toString()}`,
      { headers: backend.headers },
    );
    const answersResult = await readJsonResponse(answersResponse);
    if (!answersResult.ok) return backendErrorResponse(answersResult.body);
    if (!Array.isArray(answersResult.body)) {
      return errorResponse('INTERNAL_ERROR');
    }

    const answers: Record<string, unknown[]> = Object.create(null);
    for (const answer of answersResult.body) {
      if (typeof answer?.field_key !== 'string') continue;
      (answers[answer.field_key] ??= []).push(answer.value);
    }
    return jsonResponse(selectNextQuestion(graphRecord, answers));
  } catch {
    return errorResponse('RETRYABLE_FAILURE');
  }
});
