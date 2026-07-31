import { describe, expect, it, vi } from "vitest";
import { ApiClientError, createApiTransport } from "./transport";

function response(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

describe("API transport", () => {
  it("returns undefined for 204 responses", async () => {
    const transport = createApiTransport({
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    });

    await expect(transport.request("/empty")).resolves.toBeUndefined();
  });

  it("unwraps the current data envelope", async () => {
    const transport = createApiTransport({
      fetch: vi.fn().mockResolvedValue(response({ data: { ok: true } })),
    });

    await expect(transport.request("/mailboxes")).resolves.toEqual({
      ok: true,
    });
  });

  it("preserves known error code, status, and body request ID", async () => {
    const transport = createApiTransport({
      fetch: vi.fn().mockResolvedValue(
        response(
          {
            error: {
              code: "AUTH_REQUIRED",
              message: "Authentication required",
              requestId: "request-1",
            },
          },
          { status: 401 },
        ),
      ),
    });

    await expect(
      transport.request("/protected", {}, false),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
      requestId: "request-1",
    } satisfies Partial<ApiClientError>);
  });

  it.each(["DRAFT_NOT_FOUND", "PARENT_MESSAGE_NOT_FOUND"] as const)(
    "maps the Worker-issued %s code without degrading it to unknown",
    async (code) => {
      const transport = createApiTransport({
        fetch: vi
          .fn()
          .mockResolvedValue(
            response(
              { error: { code, message: "diagnostic only" } },
              { status: 404 },
            ),
          ),
      });

      await expect(transport.request("/mail", {}, false)).rejects.toMatchObject(
        {
          code,
          status: 404,
        } satisfies Partial<ApiClientError>,
      );
    },
  );

  it("uses the header request ID when the error body has none", async () => {
    const transport = createApiTransport({
      fetch: vi
        .fn()
        .mockResolvedValue(
          response(
            { error: { code: "PERMISSION_DENIED", message: "No access" } },
            { status: 403, headers: { "x-request-id": "header-1" } },
          ),
        ),
    });

    await expect(transport.request("/admin", {}, false)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      requestId: "header-1",
    } satisfies Partial<ApiClientError>);
  });

  it("maps unknown codes to a safe generic error while retaining diagnostics", async () => {
    const transport = createApiTransport({
      fetch: vi
        .fn()
        .mockResolvedValue(
          response(
            {
              error: {
                code: "PROVIDER_PRIVATE_FAILURE",
                message: "do not show",
              },
            },
            { status: 503 },
          ),
        ),
    });

    await expect(
      transport.request("/provider", {}, false),
    ).rejects.toMatchObject({
      code: "UNKNOWN_SERVER_ERROR",
      rawCode: "PROVIDER_PRIVATE_FAILURE",
      status: 503,
      diagnosticMessage: "do not show",
    } satisfies Partial<ApiClientError>);
  });

  it("maps non-JSON errors to a safe generic error and preserves the header request ID", async () => {
    const transport = createApiTransport({
      fetch: vi.fn().mockResolvedValue(
        new Response("upstream unavailable", {
          status: 503,
          headers: { "x-request-id": "header-503" },
        }),
      ),
    });

    await expect(
      transport.request("/provider", {}, false),
    ).rejects.toMatchObject({
      code: "UNKNOWN_SERVER_ERROR",
      status: 503,
      requestId: "header-503",
    } satisfies Partial<ApiClientError>);
  });

  it("preserves the header request ID when an error body contains malformed JSON", async () => {
    const transport = createApiTransport({
      fetch: vi.fn().mockResolvedValue(
        new Response('{"error":', {
          status: 503,
          headers: { "x-request-id": "malformed-503" },
        }),
      ),
    });

    await expect(
      transport.request("/provider", {}, false),
    ).rejects.toMatchObject({
      code: "UNKNOWN_SERVER_ERROR",
      status: 503,
      requestId: "malformed-503",
    } satisfies Partial<ApiClientError>);
  });

  it("rejects malformed successful JSON", async () => {
    const transport = createApiTransport({
      fetch: vi.fn().mockResolvedValue(response({ unexpected: true })),
    });

    await expect(transport.request("/mailboxes")).rejects.toMatchObject({
      code: "CLIENT_RESPONSE_INVALID",
      status: 200,
    } satisfies Partial<ApiClientError>);
  });

  it("refreshes once and retries once after a 401", async () => {
    let token: string | null = "expired";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          { error: { code: "AUTH_REQUIRED", message: "expired" } },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(response({ data: { accessToken: "fresh" } }))
      .mockResolvedValueOnce(response({ data: { ok: true } }));
    const transport = createApiTransport({
      fetch,
      getAccessToken: () => token,
      setAccessToken: (value) => {
        token = value;
      },
    });

    await expect(transport.request("/protected")).resolves.toEqual({
      ok: true,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1]?.[0]).toBe("/api/v1/auth/refresh");
    expect(token).toBe("fresh");
  });

  it("clears the token when refresh fails without recursing", async () => {
    let token: string | null = "expired";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          { error: { code: "AUTH_REQUIRED", message: "expired" } },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        response(
          { error: { code: "AUTH_REQUIRED", message: "bad refresh" } },
          { status: 401 },
        ),
      );
    const transport = createApiTransport({
      fetch,
      getAccessToken: () => token,
      setAccessToken: (value) => {
        token = value;
      },
    });

    await expect(transport.request("/protected")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    } satisfies Partial<ApiClientError>);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(token).toBeNull();
  });

  it("never refreshes the login endpoint", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response(
          {
            error: {
              code: "AUTH_CREDENTIALS_INVALID",
              message: "bad credentials",
            },
          },
          { status: 401 },
        ),
      );
    const transport = createApiTransport({ fetch });

    await expect(transport.request("/auth/login")).rejects.toMatchObject({
      code: "AUTH_CREDENTIALS_INVALID",
      status: 401,
    } satisfies Partial<ApiClientError>);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
