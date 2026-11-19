import { corsHeaders } from '../_shared/cors.ts';
import { submitIncidentSchema } from '../_shared/schema.ts';

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

const errorStatus: Record<string, number> = {
  AUTH_REQUIRED: 401,
  NOT_ALLOWED: 403,
  STALE_VERSION: 409,
  INCIDENT_NOT_DRAFT: 409,
  TURN_ID_REUSED: 409,
  SIGNATURE_REFERENCE_REUSED: 409,
  PROFILE_INCOMPLETE: 422,
  VALIDATION_FAILED: 422,
  EVIDENCE_INVALID: 422,
  FORM_SET_MISSING: 422,
  FORM_DEFINITION_MISSING: 422,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: jsonHeaders });
  }

  if (req.method !== 'POST') {
    return Response.json({ code: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: jsonHeaders });
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return Response.json({ code: 'AUTH_REQUIRED' }, { status: 401, headers: jsonHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const apiKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!supabaseUrl || !apiKey) {
    return Response.json({ code: 'BACKEND_UNAVAILABLE' }, { status: 503, headers: jsonHeaders });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ code: 'VALIDATION_FAILED' }, { status: 400, headers: jsonHeaders });
  }
  const parsed = submitIncidentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { code: 'VALIDATION_FAILED', issues: parsed.error.flatten() },
      { status: 400, headers: jsonHeaders },
    );
  }

  const headers = {
    apikey: apiKey,
    Authorization: authorization,
    'Content-Type': 'application/json',
  };
  try {
    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
    if (!authResponse.ok) {
      return Response.json({ code: 'AUTH_REQUIRED' }, { status: 401, headers: jsonHeaders });
    }

    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/submit_incident`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_incident_revision_id: parsed.data.incident_revision_id,
        p_expected_version: parsed.data.expected_version,
        p_signature_reference: parsed.data.signature_reference,
        p_auth_method: parsed.data.auth_method,
        p_device_description: parsed.data.device_description,
      }),
    });
    const result = await rpcResponse.json();

    if (!rpcResponse.ok) {
      const code = typeof result?.message === 'string' && errorStatus[result.message]
        ? result.message
        : 'INTERNAL_ERROR';
      return Response.json({ code }, { status: errorStatus[code] ?? 500, headers: jsonHeaders });
    }

    if (result?.code === 'VALIDATION_FAILED') {
      return Response.json(result, { status: 422, headers: jsonHeaders });
    }
    return Response.json(result, { status: 200, headers: jsonHeaders });
  } catch {
    return Response.json({ code: 'RETRYABLE_FAILURE' }, { status: 503, headers: jsonHeaders });
  }
});
