export const ORPHAN_OBJECT_GRACE_MS = 24 * 60 * 60 * 1000;

export function isOrphanCleanupEligible(
  uploadedAt: Date | undefined,
  now = Date.now(),
): boolean {
  return (
    uploadedAt instanceof Date &&
    Number.isFinite(uploadedAt.getTime()) &&
    uploadedAt.getTime() <= now - ORPHAN_OBJECT_GRACE_MS
  );
}
