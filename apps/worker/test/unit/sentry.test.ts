import { DomainError } from "@unimailbox/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  scope: { setTag: vi.fn() },
  withScope: vi.fn((callback: (scope: { setTag: typeof vi.fn }) => void) =>
    callback(sentry.scope),
  ),
}));

vi.mock("@sentry/cloudflare", () => ({
  captureException: sentry.captureException,
  withScope: sentry.withScope,
}));

import type { Env } from "../../src/platform/config";
import {
  captureWorkerHttpError,
  captureWorkerQueueError,
  createWorkerSentryOptions,
  scrubWorkerSentryEvent,
  shouldCaptureWorkerError,
} from "../../src/platform/sentry";

function env(input: Partial<Env> = {}): Env {
  return input as Env;
}

describe("Worker Sentry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is disabled without a DSN and defaults tracing off", () => {
    expect(createWorkerSentryOptions(env())).toMatchObject({
      enabled: false,
      sendDefaultPii: false,
      sampleRate: 1,
      tracesSampleRate: 0,
    });
  });

  it("uses optional deployment metadata and bounded sample rates", () => {
    expect(
      createWorkerSentryOptions(
        env({
          SENTRY_DSN: "https://public@example.invalid/2",
          SENTRY_ENVIRONMENT: "preview",
          SENTRY_SAMPLE_RATE: "0.75",
          SENTRY_TRACES_SAMPLE_RATE: "4",
          CF_VERSION_METADATA: {
            id: "version-id",
            tag: "release-tag",
            timestamp: "2026-08-03T00:00:00Z",
          },
        }),
      ),
    ).toMatchObject({
      enabled: true,
      environment: "preview",
      release: "release-tag",
      sampleRate: 0.75,
      tracesSampleRate: 1,
    });
  });

  it("scrubs Worker request and message data", () => {
    const scrubbed = scrubWorkerSentryEvent({
      message: "Delivery failed for team@example.com",
      request: {
        url: "https://mail.example.com/api/v1/messages?id=secret",
        data: { subject: "private" },
        headers: { cookie: "session=secret", accept: "application/json" },
      },
      extra: { messageId: "secret-id", safe: "retained" },
    });
    expect(scrubbed.message).toBe("Delivery failed for [REDACTED_EMAIL]");
    expect(scrubbed.request).toMatchObject({
      url: "https://mail.example.com/api/v1/messages",
      headers: { cookie: "[REDACTED]", accept: "application/json" },
    });
    expect(scrubbed.request).not.toHaveProperty("data");
    expect(scrubbed.extra).toEqual({
      messageId: "[REDACTED]",
      safe: "retained",
    });
  });

  it("captures unexpected and 5xx HTTP errors but skips expected 4xx", () => {
    const denied = new DomainError("PERMISSION_DENIED", "Denied", 403);
    const unavailable = new DomainError("INTERNAL_ERROR", "Unavailable", 503);
    expect(shouldCaptureWorkerError(denied)).toBe(false);
    expect(shouldCaptureWorkerError(unavailable)).toBe(true);

    captureWorkerHttpError(denied, {
      method: "GET",
      path: "/api/v1/admin/users",
      requestId: "request-1",
    });
    expect(sentry.captureException).not.toHaveBeenCalled();

    captureWorkerHttpError(unavailable, {
      method: "PATCH",
      path: "/api/v1/admin/users/11111111-1111-4111-8111-111111111111",
      requestId: "request-2",
    });
    expect(sentry.scope.setTag).toHaveBeenCalledWith(
      "http.route",
      "/api/v1/admin/users/:id",
    );
    expect(sentry.captureException).toHaveBeenCalledWith(unavailable);
  });

  it("captures queue errors without accepting a job payload", () => {
    const error = new Error("queue failed");
    captureWorkerQueueError(error, { attempts: 2, kind: "outbound" });
    expect(sentry.scope.setTag).toHaveBeenCalledWith(
      "queue.job.kind",
      "outbound",
    );
    expect(sentry.scope.setTag).toHaveBeenCalledWith("queue.attempts", "2");
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });
});
