import { corsHeaders } from '../_shared/cors.ts';
import { selectNextQuestionSchema } from '../_shared/schema.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const body = await req.json();
  const parsed = selectNextQuestionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { code: 'VALIDATION_FAILED', issues: parsed.error.flatten() },
      { status: 400, headers: corsHeaders },
    );
  }

  return Response.json(
    {
      code: 'NOT_IMPLEMENTED',
      message: 'select-next-question scaffolded; deterministic planner pending.',
      payload: parsed.data,
    },
    { status: 501, headers: corsHeaders },
  );
});
