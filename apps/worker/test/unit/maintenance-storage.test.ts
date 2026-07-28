import { describe, expect, it } from "vitest";
import {
  ORPHAN_OBJECT_GRACE_MS,
  isOrphanCleanupEligible,
} from "../../src/modules/maintenance/orphan-policy";

describe("orphan object cleanup policy", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");

  it("does not delete objects without a trustworthy upload time", () => {
    expect(isOrphanCleanupEligible(undefined, now)).toBe(false);
  });

  it("retains objects inside the grace period", () => {
    expect(
      isOrphanCleanupEligible(new Date(now - ORPHAN_OBJECT_GRACE_MS + 1), now),
    ).toBe(false);
  });

  it("allows unreferenced objects at the grace boundary", () => {
    expect(
      isOrphanCleanupEligible(new Date(now - ORPHAN_OBJECT_GRACE_MS), now),
    ).toBe(true);
  });

  it("rejects invalid dates and supports the current-time default", () => {
    expect(isOrphanCleanupEligible(new Date(Number.NaN), now)).toBe(false);
    expect(
      isOrphanCleanupEligible(
        new Date(Date.now() - ORPHAN_OBJECT_GRACE_MS - 1),
      ),
    ).toBe(true);
  });
});
