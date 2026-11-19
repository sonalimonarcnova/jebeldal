import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

const pendingSubmissionSchema = z.object({
  signatureReference: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  authMethod: z.enum(['biometric', 'device_passcode']),
  deviceDescription: z.string().min(1).max(160),
  createdAt: z.string().datetime(),
});

export type PendingSubmission = z.infer<typeof pendingSubmissionSchema>;

export function pendingSubmissionKey(userId: string, revisionId: string): string {
  return `incident-submit:v1:${userId}:${revisionId}`;
}

export function createSignatureReference(random: () => number = Math.random): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(random() * 16);
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export function parsePendingSubmission(value: unknown): PendingSubmission | null {
  const parsed = pendingSubmissionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function readPendingSubmission(
  userId: string,
  revisionId: string,
): Promise<PendingSubmission | null> {
  const key = pendingSubmissionKey(userId, revisionId);
  const stored = await AsyncStorage.getItem(key);
  if (!stored) return null;
  try {
    const pending = parsePendingSubmission(JSON.parse(stored));
    if (pending) return pending;
  } catch {
    // Discard malformed local retry state; the server remains the source of truth.
  }
  await AsyncStorage.removeItem(key);
  return null;
}

export async function writePendingSubmission(
  userId: string,
  revisionId: string,
  pending: PendingSubmission,
): Promise<void> {
  const parsed = pendingSubmissionSchema.parse(pending);
  await AsyncStorage.setItem(
    pendingSubmissionKey(userId, revisionId),
    JSON.stringify(parsed),
  );
}

export async function clearPendingSubmission(
  userId: string,
  revisionId: string,
): Promise<void> {
  await AsyncStorage.removeItem(pendingSubmissionKey(userId, revisionId));
}
