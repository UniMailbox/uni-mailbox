import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError } from "./api";
import {
  apiRequest,
  apiResponse,
  getAccessToken,
  jsonBody,
  setAccessToken,
} from "./api";

describe("API client extras", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("serializes JSON bodies via the helper", () => {
    expect(jsonBody({ hello: "world" })).toBe('{"hello":"world"}');
  });

  it("returns undefined for 204 No Content responses", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await expect(apiRequest("/empty")).resolves.toBeUndefined();
  });

  it("synthesises a REQUEST_FAILED error when the body is non-error JSON", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json({ unexpected: true }, { status: 500 }),
    );
    await expect(apiRequest("/oops", {}, false)).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      status: 500,
    } satisfies Partial<ApiError>);
  });

  it("clears the access token and surfaces the API error when the refresh request fails", async () => {
    setAccessToken("expired-token");
    const fetchMock = vi
      .spyOn(window, "fetch")
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "AUTH_TOKEN_INVALID",
              message: "Expired",
              requestId: "req-1",
            },
          },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "AUTH_CREDENTIALS_INVALID",
              message: "Bad refresh",
              requestId: "req-2",
            },
          },
          { status: 401 },
        ),
      );

    await expect(apiRequest("/protected", {}, true)).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    } satisfies Partial<ApiError>);
    expect(getAccessToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/protected");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/refresh");
  });

  it("retries once after a successful refresh", async () => {
    setAccessToken("expired-token");
    const fetchMock = vi
      .spyOn(window, "fetch")
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "AUTH_TOKEN_INVALID",
              message: "Expired",
              requestId: "req-1",
            },
          },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { data: { accessToken: "fresh-token" } },
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ data: { ok: true } }, { status: 200 }),
      );

    await expect(apiRequest("/protected", {}, true)).resolves.toEqual({
      ok: true,
    });
    expect(getAccessToken()).toBe("fresh-token");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry the login endpoint on 401", async () => {
    setAccessToken("expired-token");
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json(
        {
          error: {
            code: "AUTH_CREDENTIALS_INVALID",
            message: "Bad credentials",
            requestId: "req-1",
          },
        },
        { status: 401 },
      ),
    );

    await expect(apiRequest("/auth/login", {}, true)).rejects.toMatchObject({
      code: "AUTH_CREDENTIALS_INVALID",
    } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exposes a raw response helper that returns the unparsed Response", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json({ data: { ok: true } }, { status: 200 }),
    );
    const response = await apiResponse("/ping", {}, false);
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ data: { ok: true } });
  });

  it("propagates structured error details from the server", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Bad input",
            details: { field: "email" },
            requestId: "req-1",
          },
        },
        { status: 400 },
      ),
    );
    await expect(apiRequest("/validate", {}, false)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      details: { field: "email" },
    } satisfies Partial<ApiError>);
  });
});
