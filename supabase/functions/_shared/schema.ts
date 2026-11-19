import { z } from 'https://deno.land/x/zod@v3.24.1/mod.ts';

export const incidentTurnSchema = z
  .object({
    incident_revision_id: z.string().uuid(),
    client_turn_id: z.string().min(1),
    // The current question, used to prioritise it in extraction. All optional: the interview app may send
    // the pinned (form_key, field_key) from select-next-question; the voice dev screen sends question_key.
    question_key: z.string().min(1).optional(),
    form_key: z.string().min(1).optional(),
    field_key: z.string().min(1).optional(),
    audio_evidence_id: z.string().uuid().optional(),
    text: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const inputs = [value.audio_evidence_id, value.text].filter(Boolean).length;
    if (inputs !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of audio_evidence_id or text',
      });
    }
    if (Boolean(value.form_key) !== Boolean(value.field_key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide form_key and field_key together',
      });
    }
  });

export const selectNextQuestionSchema = z.object({
  incident_revision_id: z.string().uuid(),
});

export const submitIncidentSchema = z.object({
  incident_revision_id: z.string().uuid(),
  expected_version: z.number().int().positive(),
  signature_reference: z.string().uuid(),
  auth_method: z.enum(['biometric', 'device_passcode']),
  device_description: z.string().trim().min(1).max(160),
});
