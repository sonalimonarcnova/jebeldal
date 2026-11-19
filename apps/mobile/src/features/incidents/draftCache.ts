import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import { draftCacheKey } from './draftCacheKey';

const cachedTextSchema = z.object({
  text: z.string(),
  expectedVersion: z.number().int().positive(),
  updatedAt: z.string(),
});

export type CachedDraftText = z.infer<typeof cachedTextSchema>;

export async function readCachedDraftText(
  userId: string,
  revisionId: string,
  fieldKey: string,
): Promise<CachedDraftText | null> {
  const stored = await AsyncStorage.getItem(draftCacheKey(userId, revisionId, fieldKey));
  if (stored === null) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(stored);
  } catch {
    throw new Error('The saved local draft is unreadable. Retry the server copy before editing.');
  }

  const parsed = cachedTextSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error('The saved local draft has an invalid format.');
  }
  return parsed.data;
}

export async function writeCachedDraftText(
  userId: string,
  revisionId: string,
  fieldKey: string,
  text: string,
  expectedVersion: number,
): Promise<void> {
  const cached = cachedTextSchema.parse({
    text,
    expectedVersion,
    updatedAt: new Date().toISOString(),
  });
  await AsyncStorage.setItem(
    draftCacheKey(userId, revisionId, fieldKey),
    JSON.stringify(cached),
  );
}

export async function clearCachedDraftText(
  userId: string,
  revisionId: string,
  fieldKey: string,
): Promise<void> {
  await AsyncStorage.removeItem(draftCacheKey(userId, revisionId, fieldKey));
}
