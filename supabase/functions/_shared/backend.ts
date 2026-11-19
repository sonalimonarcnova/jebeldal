import { corsHeaders } from './cors.ts';

const errorStatuses: Record<string, number> = {
  AUTH_REQUIRED: 401,
  NOT_ALLOWED: 403,
  INCIDENT_NOT_DRAFT: 409,
  TURN_ID_REUSED: 409,
  VALIDATION_FAILED: 400,
  PROVIDER_UNAVAILABLE: 503,
  RETRYABLE_FAILURE: 503,
  INTERNAL_ERROR: 500,
  METHOD_NOT_ALLOWED: 405,
};

export type AuthenticatedBackend = {
  url: string;
  headers: HeadersInit;
};

export function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(
  code: keyof typeof errorStatuses,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ code, ...extra }, errorStatuses[code]);
}

export async function authenticateRequest(
  req: Request,
): Promise<AuthenticatedBackend | Response> {
  const authorization = req.headers.get('Authorization');
  if (!authorization || !/^Bearer\s+\S+$/iu.test(authorization)) {
    return errorResponse('AUTH_REQUIRED');
  }

  const url = Deno.env.get('SUPABASE_URL');
  const apiKey = Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !apiKey) {
    return errorResponse('RETRYABLE_FAILURE');
  }

  const headers = {
    apikey: apiKey,
    Authorization: authorization,
    'Content-Type': 'application/json',
  };
  try {
    const response = await fetch(`${url}/auth/v1/user`, { headers });
    if (!response.ok) {
      return errorResponse('AUTH_REQUIRED');
    }

    const user = await response.json();
    if (!user || typeof user.id !== 'string') {
      return errorResponse('AUTH_REQUIRED');
    }
  } catch {
    return errorResponse('RETRYABLE_FAILURE');
  }

  return { url, headers };
}

export async function readJsonResponse(
  response: Response,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON backend response is handled as an internal error by the caller.
  }
  return { ok: response.ok, status: response.status, body };
}

export function backendErrorCode(body: unknown): keyof typeof errorStatuses {
  if (body && typeof body === 'object') {
    const value = body as Record<string, unknown>;
    for (const candidate of [value.code, value.message]) {
      if (typeof candidate === 'string' && candidate in errorStatuses) {
        return candidate as keyof typeof errorStatuses;
      }
    }
  }
  return 'INTERNAL_ERROR';
}

export function backendErrorResponse(body: unknown): Response {
  return errorResponse(backendErrorCode(body));
}
