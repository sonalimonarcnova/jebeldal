import { corsHeaders } from '../_shared/cors.ts';
import {
  authenticateRequest,
  backendErrorResponse,
  errorResponse,
  jsonResponse,
  readJsonResponse,
  type AuthenticatedBackend,
} from '../_shared/backend.ts';
import { generateSummarySchema } from '../_shared/schema.ts';
import { selectProviders } from '../process-incident-turn/providers.ts';
import {
  buildSummaryForm,
  mapSummaryError,
  summarize,
  type SummaryAnswerRow,
  type SummaryDefinition,
} from './summarize.ts';

const FN = 'generate-summary';

type TriggeredForm = {
  form_key: string;
  form_version: number;
};

type FormDefinitionRow = {
  form_key: string;
  version: number;
  status: string;
  definition: unknown;
};

type SelectResult<T> = { rows: T[] } | { response: Response };

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

async function selectRows<T>(
  backend: AuthenticatedBackend,
  table: 'incident_revisions' | 'incident_revision_forms' | 'form_definitions' | 'incident_answers',
  params: Record<string, string>,
): Promise<SelectResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${backend.url}/rest/v1/${table}?${query(params)}`, {
      headers: backend.headers,
    });
  } catch {
    return { response: errorResponse('RETRYABLE_FAILURE') };
  }
  const result = await readJsonResponse(response);
  if (!result.ok) return { response: backendErrorResponse(result.body) };
  if (!Array.isArray(result.body)) return { response: errorResponse('INTERNAL_ERROR') };
  return { rows: result.body as T[] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED');

  const backend = await authenticateRequest(req);
  if (backend instanceof Response) return backend;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED');
  }
  const parsed = generateSummarySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', { issues: parsed.error.flatten() });
  }

  const started = performance.now();
  const revisionResult = await selectRows<{ id: string }>(
    backend,
    'incident_revisions',
    { select: 'id', id: `eq.${parsed.data.incident_revision_id}` },
  );
  if ('response' in revisionResult) return revisionResult.response;
  if (revisionResult.rows.length === 0) return errorResponse('NOT_ALLOWED');

  const formsResult = await selectRows<TriggeredForm>(
    backend,
    'incident_revision_forms',
    {
      select: 'form_key,form_version',
      incident_revision_id: `eq.${parsed.data.incident_revision_id}`,
      activation_status: 'eq.triggered',
      order: 'form_key.asc',
    },
  );
  if ('response' in formsResult) return formsResult.response;
  if (formsResult.rows.length === 0) return errorResponse('VALIDATION_FAILED');
  if (
    formsResult.rows.some((form) =>
      typeof form.form_key !== 'string' ||
      !Number.isInteger(form.form_version) ||
      form.form_version < 1
    )
  ) {
    return errorResponse('INTERNAL_ERROR');
  }

  const definitions: FormDefinitionRow[] = [];
  for (const form of formsResult.rows) {
    const definitionResult = await selectRows<FormDefinitionRow>(
      backend,
      'form_definitions',
      {
        select: 'form_key,version,status,definition',
        form_key: `eq.${form.form_key}`,
        version: `eq.${form.form_version}`,
        status: 'eq.active',
      },
    );
    if ('response' in definitionResult) return definitionResult.response;
    const definition = definitionResult.rows[0];
    if (
      !definition ||
      definition.form_key !== form.form_key ||
      definition.version !== form.form_version ||
      definition.status !== 'active' ||
      !isRecord(definition.definition)
    ) {
      return errorResponse('INTERNAL_ERROR');
    }
    definitions.push(definition);
  }

  const answersResult = await selectRows<SummaryAnswerRow>(
    backend,
    'incident_answers',
    {
      select: 'form_key,field_key,value,answer_state',
      incident_revision_id: `eq.${parsed.data.incident_revision_id}`,
      answer_state: 'eq.confirmed',
      order: 'form_key.asc,field_key.asc,group_instance_id.asc',
    },
  );
  if ('response' in answersResult) return answersResult.response;

  const sourceDefinitions: SummaryDefinition[] = definitions.map((form) => ({
    form_key: form.form_key,
    definition: form.definition,
  }));
  const summaryForms = formsResult.rows.map((form, index) =>
    buildSummaryForm(form.form_key, definitions[index].definition, answersResult.rows, sourceDefinitions)
  );

  let providers;
  try {
    providers = selectProviders();
  } catch (error) {
    const mapped = mapSummaryError(error);
    if (mapped) return mapped;
    throw error;
  }

  const descriptions = await summarize(summaryForms, providers.mode, {
    apiKey: Deno.env.get('XAI_API_KEY'),
    model: Deno.env.get('XAI_EXTRACT_MODEL'),
  });
  return jsonResponse({
    descriptions,
    mode: providers.mode,
    latency_ms: Math.round(performance.now() - started),
  });
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    const mapped = mapSummaryError(error);
    if (mapped) return mapped;
    console.error(JSON.stringify({
      fn: FN,
      event: 'failed',
      error_code: error instanceof Error ? error.name : 'unknown',
    }));
    return errorResponse('INTERNAL_ERROR');
  }
});
