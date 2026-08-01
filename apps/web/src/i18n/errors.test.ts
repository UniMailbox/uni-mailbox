import { ApiClientError } from "../lib/api/errors";
import { describe, expect, it } from "vitest";
import { createTestI18n } from "./test-instance";
import { apiErrorToken } from "./errors";

describe("apiErrorToken", () => {
  it("localizes a known API code without rendering the server message", () => {
    const error = new ApiClientError("AUTH_REQUIRED", 401, {
      requestId: "request-1",
      diagnosticMessage: "server-only English",
    });

    expect(apiErrorToken(error)).toEqual({
      key: "errors:api.AUTH_REQUIRED",
      values: {},
      requestId: "request-1",
    });
  });

  it("uses a generic localized token for unknown failures", () => {
    expect(apiErrorToken(new Error("raw text")).key).toBe(
      "errors:api.UNKNOWN_SERVER_ERROR",
    );
  });

  it.each([
    ["en", "Authentication is required."],
    ["zh-CN", "需要进行身份验证。"],
  ] as const)(
    "provides a translated %s known-code message",
    (locale, expected) => {
      const i18n = createTestI18n(locale);
      const token = apiErrorToken(new ApiClientError("AUTH_REQUIRED", 401));

      expect(i18n.t(token.key, token.values)).toBe(expected);
    },
  );
});
