import { corsHeaders } from '../_shared/cors.ts';
import {
  authenticateRequest,
  backendErrorResponse,
  errorResponse,
  jsonResponse,
  readJsonResponse,
} from '../_shared/backend.ts';
import { selectNextQuestionSchema } from '../_shared/schema.ts';
import {
  buildInterviewAnswerContext,
  prepareInterviewGraph,
  selectNextQuestion,
} from '../_shared/interview.mjs';

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

    const pinnedFormsQuery = new URLSearchParams({
      select: 'form_key,form_version,activation_status',
      incident_revision_id: `eq.${parsed.data.incident_revision_id}`,
    });
    const pinnedFormsResponse = await fetch(
      `${backend.url}/rest/v1/incident_revision_forms?${pinnedFormsQuery.toString()}`,
      { headers: backend.headers },
    );
    const pinnedFormsResult = await readJsonResponse(pinnedFormsResponse);
    if (!pinnedFormsResult.ok) return backendErrorResponse(pinnedFormsResult.body);
    if (!Array.isArray(pinnedFormsResult.body)) {
      return errorResponse('INTERNAL_ERROR');
    }

    const pinnedForms = await Promise.all(
      pinnedFormsResult.body.map(async (form: Record<string, unknown>) => {
        if (
          typeof form.form_key !== 'string' ||
          typeof form.form_version !== 'number' ||
          typeof form.activation_status !== 'string'
        ) {
          return null;
        }
        const definitionQuery = new URLSearchParams({
          select: 'definition',
          form_key: `eq.${form.form_key}`,
          version: `eq.${form.form_version}`,
        });
        const definitionResponse = await fetch(
          `${backend.url}/rest/v1/form_definitions?${definitionQuery.toString()}`,
          { headers: backend.headers },
        );
        const definitionResult = await readJsonResponse(definitionResponse);
        if (!definitionResult.ok) {
          throw new Error('PINNED_FORM_DEFINITION_UNAVAILABLE');
        }
        const row = Array.isArray(definitionResult.body)
          ? definitionResult.body[0] as Record<string, unknown> | undefined
          : null;
        return {
          form_key: form.form_key,
          activation_status: form.activation_status,
          definition: row?.definition,
        };
      }),
    );
    if (pinnedForms.some((form) => form === null)) {
      return errorResponse('INTERNAL_ERROR');
    }

    const answersQuery = new URLSearchParams({
      select: 'form_key,field_key,value,answer_state',
      incident_revision_id: `eq.${parsed.data.incident_revision_id}`,
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

    const answerContext = buildInterviewAnswerContext(answersResult.body);
    const preparedGraph = prepareInterviewGraph(
      graphRecord,
      pinnedForms as {
        form_key: string;
        activation_status: string;
        definition: unknown;
      }[],
      answerContext.confirmedAnswersByForm,
    );
    return jsonResponse(selectNextQuestion(
      preparedGraph,
      answerContext.confirmedAnswers,
      answerContext.persistedAnswerKeys,
    ));
  } catch {
    return errorResponse('RETRYABLE_FAILURE');
  }
});
