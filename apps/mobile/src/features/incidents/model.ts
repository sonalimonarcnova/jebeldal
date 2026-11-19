import { z } from 'zod';
import { persistedAnswerStates } from './rpcOperations';

const incidentRowSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['draft', 'submitted']),
  active_revision_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const revisionRowSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'submitted']),
  form_set_key: z.string(),
  form_set_version: z.number().int().positive(),
  occurred_at: z.string().nullable(),
  location: z.unknown().nullable(),
  report_reference: z.string().nullable(),
});

const answerRowSchema = z.object({
  incident_revision_id: z.string().uuid(),
  field_key: z.string(),
  value: z.unknown(),
  answer_state: z.enum(persistedAnswerStates),
});

const revisionFormRowSchema = z.object({
  incident_revision_id: z.string().uuid(),
  form_key: z.string(),
  activation_status: z.enum(['triggered', 'not_triggered']),
});

export type IncidentCard = {
  id: string;
  status: 'draft' | 'submitted';
  activeRevisionId: string | null;
  updatedAt: string;
  occurredAt: string | null;
  location: string | null;
  reportReference: string | null;
  summary: string | null;
  triggeredForms: string[];
  revisionVersion: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function formatLocation(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  for (const key of ['label', 'address', 'formatted_address', 'description']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

export function mapIncidentCards(
  rawIncidents: unknown,
  rawRevisions: unknown,
  rawAnswers: unknown,
  rawRevisionForms: unknown,
): IncidentCard[] {
  const incidents = z.array(incidentRowSchema).parse(rawIncidents);
  const revisions = z.array(revisionRowSchema).parse(rawRevisions);
  const answers = z.array(answerRowSchema).parse(rawAnswers);
  const revisionForms = z.array(revisionFormRowSchema).parse(rawRevisionForms);

  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  const summaryByRevision = new Map<string, string>();
  for (const answer of answers) {
    if (
      answer.field_key === 'what_happened' &&
      answer.answer_state === 'confirmed' &&
      typeof answer.value === 'string' &&
      answer.value.trim()
    ) {
      summaryByRevision.set(answer.incident_revision_id, answer.value.trim());
    }
  }

  const formsByRevision = new Map<string, string[]>();
  for (const form of revisionForms) {
    if (form.activation_status !== 'triggered') {
      continue;
    }
    const existing = formsByRevision.get(form.incident_revision_id) ?? [];
    existing.push(form.form_key);
    formsByRevision.set(form.incident_revision_id, existing);
  }

  return incidents.map((incident) => {
    const revision = incident.active_revision_id
      ? revisionById.get(incident.active_revision_id)
      : undefined;

    return {
      id: incident.id,
      status: incident.status,
      activeRevisionId: incident.active_revision_id,
      updatedAt: incident.updated_at,
      occurredAt: revision?.occurred_at ?? null,
      location: revision ? formatLocation(revision.location) : null,
      reportReference: revision?.report_reference ?? null,
      summary:
        incident.active_revision_id && summaryByRevision.has(incident.active_revision_id)
          ? summaryByRevision.get(incident.active_revision_id) ?? null
          : null,
      triggeredForms: incident.active_revision_id
        ? formsByRevision.get(incident.active_revision_id) ?? []
        : [],
      revisionVersion: revision?.version ?? null,
    };
  });
}

export function getConfirmedTextAnswer(value: unknown, answerState: string): string {
  return answerState === 'confirmed' && typeof value === 'string' ? value : '';
}
