import { z } from 'zod';

const tripRowSchema = z.object({
  id: z.string().uuid(),
  started_at: z.string().nullable(),
  route: z.unknown(),
  purpose: z.string().nullable(),
  vehicle_id: z.string().uuid().nullable(),
  dvir_summary: z.unknown(),
});

export type HomeTrip = {
  id: string;
  startedAt: string | null;
  origin: string | null;
  destination: string | null;
  purpose: string | null;
  preTripStatus: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordString(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

export function mapHomeTrip(rawTrip: unknown): HomeTrip | null {
  if (rawTrip === null) {
    return null;
  }
  const parsed = tripRowSchema.safeParse(rawTrip);
  if (!parsed.success) {
    throw new Error('The trip record returned by Supabase is invalid.');
  }

  return {
    id: parsed.data.id,
    startedAt: parsed.data.started_at,
    origin: recordString(parsed.data.route, 'origin'),
    destination: recordString(parsed.data.route, 'destination'),
    purpose: parsed.data.purpose,
    preTripStatus: recordString(parsed.data.dvir_summary, 'status'),
  };
}
