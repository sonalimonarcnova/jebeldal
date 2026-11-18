import { corsHeaders } from '../_shared/cors.ts';
import { submitIncidentSchema } from '../_shared/schema.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const body = await req.json();
  const parsed = submitIncidentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { code: 'VALIDATION_FAILED', issues: parsed.error.flatten() },
      { status: 400, headers: corsHeaders },
    );
  }

  return Response.json(
    {
      code: 'NOT_IMPLEMENTED',
      message: 'submit-incident scaffolded; validation + idempotent transition pending.',
      payload: parsed.data,
    },
    { status: 501, headers: corsHeaders },
  );
});
