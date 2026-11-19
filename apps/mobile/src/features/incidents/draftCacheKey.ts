export function draftCacheKey(userId: string, revisionId: string, fieldKey: string): string {
  return `jebeldal:draft:${userId}:${revisionId}:${fieldKey}`;
}
