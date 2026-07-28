import { describe, expect, it } from "vitest";
import { shouldApplyProviderStatus } from "../../src/modules/provider-sync";

describe("provider status ordering", () => {
  it("accepts the first event and newer events", () => {
    expect(
      shouldApplyProviderStatus(null, {
        eventTime: 100,
        statusRank: 30,
      }),
    ).toBe(true);
    expect(
      shouldApplyProviderStatus(
        { eventTime: 100, statusRank: 50 },
        { eventTime: 101, statusRank: 10 },
      ),
    ).toBe(true);
  });

  it("uses rank only when event times are equal", () => {
    expect(
      shouldApplyProviderStatus(
        { eventTime: 100, statusRank: 50 },
        { eventTime: 100, statusRank: 60 },
      ),
    ).toBe(true);
    expect(
      shouldApplyProviderStatus(
        { eventTime: 100, statusRank: 50 },
        { eventTime: 100, statusRank: 40 },
      ),
    ).toBe(false);
    expect(
      shouldApplyProviderStatus(
        { eventTime: 100, statusRank: 30 },
        { eventTime: 99, statusRank: 70 },
      ),
    ).toBe(false);
  });
});
