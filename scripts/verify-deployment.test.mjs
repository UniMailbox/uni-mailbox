import { describe, expect, it } from "vitest";
import { validateHealthRelease } from "./verify-deployment-lib.mjs";

function health(overrides = {}) {
  return {
    data: {
      status: "ok",
      checks: {
        database: "ok",
        kv: "ok",
        r2: "missing",
        queue: "ok",
        assets: "ok",
        scheduled: "pending",
      },
      release: {
        applicationVersion: "0.2.0",
        upstreamVersion: "0.2.0",
        workerVersionId: "worker-version",
        deployedAt: "2026-08-02T00:00:00.000Z",
      },
      ...overrides,
    },
  };
}

describe("post-deploy health gate", () => {
  it("accepts optional R2 and a pending Cron heartbeat", () => {
    expect(validateHealthRelease(health(), "0.2.0")).toEqual({
      warnings: ["scheduled trigger is pending"],
    });
  });

  it("rejects required resource and version mismatches", () => {
    expect(() =>
      validateHealthRelease(
        health({
          checks: {
            ...health().data.checks,
            queue: "missing",
          },
        }),
        "0.2.0",
      ),
    ).toThrow(/queue/iu);
    expect(() => validateHealthRelease(health(), "0.3.0")).toThrow(
      /applicationVersion/iu,
    );
  });
});
