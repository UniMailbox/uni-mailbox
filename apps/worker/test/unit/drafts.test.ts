import { describe, expect, it } from "vitest";
import { assertDraftVersion } from "../../src/modules/messages/drafts";

describe("draft optimistic concurrency", () => {
  it("accepts the current version", () => {
    expect(() =>
      assertDraftVersion(
        "2026-07-27 12:00:00.123",
        '"2026-07-27 12:00:00.123"',
      ),
    ).not.toThrow();
  });

  it("rejects missing and stale If-Match values", () => {
    expect(() =>
      assertDraftVersion("2026-07-27 12:00:00.123", undefined),
    ).toThrowError(/If-Match/i);
    expect(() =>
      assertDraftVersion(
        "2026-07-27 12:00:00.123",
        '"2026-07-27 11:59:59.999"',
      ),
    ).toThrowError(/modified/i);
  });
});
