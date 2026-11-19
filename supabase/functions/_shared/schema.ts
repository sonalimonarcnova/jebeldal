import { z } from 'https://deno.land/x/zod@v3.24.1/mod.ts';

export const incidentTurnSchema = z
  .object({
    incident_revision_id: z.string().uuid(),
    client_turn_id: z.string().min(1),
    question_key: z.string().min(1),
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
  });

export const selectNextQuestionSchema = z.object({
  incident_revision_id: z.string().uuid(),
});

export const submitIncidentSchema = z.object({
  incident_revision_id: z.string().uuid(),
  expected_version: z.number().int().positive(),
  signature_reference: z.string().uuid(),
});
