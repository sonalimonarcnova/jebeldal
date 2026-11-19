import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

const cacheSchema = z.object({
  expectedVersion: z.number().int().positive(),
  dirtyFieldIds: z.array(z.string()),
  values: z.record(z.string(), z.unknown()),
  updatedAt: z.string(),
});

export type CachedDraftEdits = z.infer<typeof cacheSchema>;

export type DraftEditRecovery =
  | { kind: 'none' }
  | { kind: 'restore'; values: Record<string, unknown>; dirtyFieldIds: string[] }
  | {
    kind: 'conflict';
    values: Record<string, unknown>;
    dirtyFieldIds: string[];
    expectedVersion: number;
    currentVersion: number;
  };

export function draftEditCacheKey(userId: string, revisionId: string): string {
  return `incident-edits:v1:${userId}:${revisionId}`;
}

export function resolveCachedDraftEdits(
  cached: CachedDraftEdits | null,
  currentVersion: number,
  forceConflict = false,
): DraftEditRecovery {
  if (!cached || cached.dirtyFieldIds.length === 0) return { kind: 'none' };
  const recovery = {
    values: Object.fromEntries(
      cached.dirtyFieldIds
        .filter((fieldId) => Object.hasOwn(cached.values, fieldId))
        .map((fieldId) => [fieldId, cached.values[fieldId]]),
    ),
    dirtyFieldIds: cached.dirtyFieldIds.filter((fieldId) => Object.hasOwn(cached.values, fieldId)),
  };
  if (recovery.dirtyFieldIds.length === 0) return { kind: 'none' };
  return cached.expectedVersion === currentVersion && !forceConflict
    ? { kind: 'restore', ...recovery }
    : {
      kind: 'conflict',
      ...recovery,
      expectedVersion: cached.expectedVersion,
      currentVersion,
    };
}

export async function readCachedDraftEdits(
  userId: string,
  revisionId: string,
): Promise<CachedDraftEdits | null> {
  const key = draftEditCacheKey(userId, revisionId);
  const stored = await AsyncStorage.getItem(key);
  if (stored === null) return null;
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(stored));
    if (parsed.success) return parsed.data;
  } catch {
    // Malformed local edits must not be sent to the server.
  }
  await AsyncStorage.removeItem(key);
  return null;
}

export async function writeCachedDraftEdits(
  userId: string,
  revisionId: string,
  cached: Omit<CachedDraftEdits, 'updatedAt'>,
): Promise<void> {
  const parsed = cacheSchema.parse({ ...cached, updatedAt: new Date().toISOString() });
  if (parsed.dirtyFieldIds.length === 0) {
    await clearCachedDraftEdits(userId, revisionId);
    return;
  }
  await AsyncStorage.setItem(draftEditCacheKey(userId, revisionId), JSON.stringify(parsed));
}

export async function clearCachedDraftEdits(
  userId: string,
  revisionId: string,
): Promise<void> {
  await AsyncStorage.removeItem(draftEditCacheKey(userId, revisionId));
}
