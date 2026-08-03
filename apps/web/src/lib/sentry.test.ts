import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  init: vi.fn(),
  scope: { setTag: vi.fn() },
  withScope: vi.fn((callback: (scope: { setTag: typeof vi.fn }) => void) =>
    callback(sentry.scope),
  ),
}));

vi.mock("@sentry/react", () => ({
  captureException: sentry.captureException,
  init: sentry.init,
  withScope: sentry.withScope,
}));

import { ForbiddenRouteError } from "./forbidden-route-error";
import { ApiClientError } from "./api/errors";
import {
  captureBrowserError,
  captureRouteError,
  initBrowserSentry,
  parseSentrySampleRate,
  resetBrowserSentryForTests,
  scrubBrowserSentryEvent,
} from "./sentry";

describe("browser Sentry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBrowserSentryForTests();
  });

  it("stays disabled without a DSN", () => {
    expect(initBrowserSentry({})).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
    captureRouteError(new Error("not sent"));
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("initializes without default PII and with bounded sampling", () => {
    expect(
      initBrowserSentry({
        dsn: " https://public@example.invalid/1 ",
        environment: "production",
        release: "release-1",
        sampleRate: "2",
        tracesSampleRate: "0.25",
      }),
    ).toBe(true);
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.invalid/1",
        environment: "production",
        release: "release-1",
        sampleRate: 1,
        tracesSampleRate: 0.25,
        sendDefaultPii: false,
      }),
    );
    expect(parseSentrySampleRate("invalid", 0.5)).toBe(0.5);
    expect(parseSentrySampleRate(-1, 1)).toBe(0);
  });

  it("removes request data, credentials, query strings, and email values", () => {
    const scrubbed = scrubBrowserSentryEvent({
      message: "Failed for member@example.com",
      request: {
        url: "https://mail.example.com/admin/users?cursor=secret#fragment",
        cookies: { session: "secret" },
        data: { password: "secret" },
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
      },
      extra: {
        mailboxId: "mailbox-secret",
        nested: { email: "member@example.com", safe: "retained" },
      },
      user: { id: "opaque-user", email: "member@example.com" },
    });
    expect(scrubbed.message).toBe("Failed for [REDACTED_EMAIL]");
    expect(scrubbed.request).toMatchObject({
      url: "https://mail.example.com/admin/users",
      headers: {
        authorization: "[REDACTED]",
        "content-type": "application/json",
      },
    });
    expect(scrubbed.request).not.toHaveProperty("cookies");
    expect(scrubbed.request).not.toHaveProperty("data");
    expect(scrubbed.extra).toEqual({
      mailboxId: "[REDACTED]",
      nested: { email: "[REDACTED]", safe: "retained" },
    });
    expect(scrubbed.user).toEqual({ id: "opaque-user" });
  });

  it("captures route failures but skips intentional permission denials", () => {
    initBrowserSentry({ dsn: "https://public@example.invalid/1" });
    captureRouteError(new ForbiddenRouteError("user.read"), {
      routeId: "/admin/users",
    });
    expect(sentry.captureException).not.toHaveBeenCalled();

    const error = new Error("render failed");
    captureRouteError(error, { routeId: "/admin/users" });
    expect(sentry.scope.setTag).toHaveBeenCalledWith(
      "route.id",
      "/admin/users",
    );
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });

  it("captures unexpected API failures but skips expected client errors", () => {
    initBrowserSentry({ dsn: "https://public@example.invalid/1" });
    captureBrowserError(new ApiClientError("PERMISSION_DENIED", 403), "query");
    expect(sentry.captureException).not.toHaveBeenCalled();

    const serverError = new ApiClientError("INTERNAL_ERROR", 500);
    captureBrowserError(serverError, "mutation");
    expect(sentry.scope.setTag).toHaveBeenCalledWith(
      "api.error.code",
      "INTERNAL_ERROR",
    );
    expect(sentry.captureException).toHaveBeenCalledWith(serverError);
  });
});
