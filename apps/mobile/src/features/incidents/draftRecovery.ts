import type { CachedDraftText } from './draftCache';

export type DraftCacheConflict = {
  localText: string;
  serverText: string;
  expectedVersion: number;
  currentVersion: number;
};

export type DraftCacheRecovery =
  | { kind: 'none' }
  | { kind: 'restore'; text: string; dirty: boolean }
  | { kind: 'conflict'; conflict: DraftCacheConflict };

export function resolveCachedDraftText(
  cachedDraft: CachedDraftText | null,
  serverDraft: { narrative: string; version: number },
): DraftCacheRecovery {
  if (!cachedDraft) {
    return { kind: 'none' };
  }

  if (cachedDraft.expectedVersion !== serverDraft.version) {
    return {
      kind: 'conflict',
      conflict: {
        localText: cachedDraft.text,
        serverText: serverDraft.narrative,
        expectedVersion: cachedDraft.expectedVersion,
        currentVersion: serverDraft.version,
      },
    };
  }

  return {
    kind: 'restore',
    text: cachedDraft.text,
    dirty: cachedDraft.text !== serverDraft.narrative,
  };
}
