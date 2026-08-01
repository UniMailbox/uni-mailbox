import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { attachmentEndpoints, defineEndpoint } from "@unimailbox/contracts";
import { createApiClient } from "./client";
import { createApiTransport } from "./transport";

const readMailbox = defineEndpoint({
  method: "GET",
  path: "/mailboxes/:mailboxId",
  request: { params: z.object({ mailboxId: z.string().uuid() }) },
  responses: { 200: z.object({ id: z.string().uuid() }) },
  errors: ["AUTH_REQUIRED", "NOT_FOUND"],
  mediaType: "json",
});

const downloadAttachment = defineEndpoint({
  method: "GET",
  path: "/attachments/:attachmentId/download",
  request: { params: z.object({ attachmentId: z.string().uuid() }) },
  responses: { 200: z.instanceof(ArrayBuffer) },
  errors: ["AUTH_REQUIRED", "ATTACHMENT_NOT_FOUND"],
  mediaType: "binary",
});

const startProviderAuthorization = defineEndpoint({
  method: "POST",
  path: "/admin/provider-authorization",
  responses: { 302: z.string().url() },
  errors: ["AUTH_REQUIRED", "PERMISSION_DENIED"],
  mediaType: "redirect",
});

describe("typed API client", () => {
  it("builds encoded paths and validates the selected response schema", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ id: "d9fbf784-e709-4ec4-a2ca-3385e5ff1aa6" });
    const client = createApiClient({ request } as never);

    await expect(
      client.request(readMailbox, {
        params: { mailboxId: "d9fbf784-e709-4ec4-a2ca-3385e5ff1aa6" },
      }),
    ).resolves.toEqual({ id: "d9fbf784-e709-4ec4-a2ca-3385e5ff1aa6" });
    expect(request).toHaveBeenCalledWith(
      "/mailboxes/d9fbf784-e709-4ec4-a2ca-3385e5ff1aa6",
      { method: "GET", headers: undefined },
    );
  });

  it("rejects a successful body that violates the endpoint schema", async () => {
    const client = createApiClient({
      request: vi.fn().mockResolvedValue({ id: 123 }),
    } as never);

    await expect(
      client.request(readMailbox, {
        params: { mailboxId: "d9fbf784-e709-4ec4-a2ca-3385e5ff1aa6" },
      }),
    ).rejects.toMatchObject({ code: "CLIENT_RESPONSE_INVALID", status: 200 });
  });

  it("returns a binary endpoint response without JSON-envelope decoding", async () => {
    const client = createApiClient(
      createApiTransport({
        fetch: vi.fn().mockResolvedValue(new Response(Uint8Array.of(1, 2, 3))),
      }),
    );

    const download = await client.request(downloadAttachment, {
      params: { attachmentId: "d9fbf784-e709-4ec4-a2ca-3385e5ff1aa6" },
    });

    expect([...new Uint8Array(download)]).toEqual([1, 2, 3]);
  });

  it("returns a contract-defined binary download blob with content-disposition metadata", async () => {
    const client = createApiClient(
      createApiTransport({
        fetch: vi.fn().mockResolvedValue(
          new Response("contents", {
            headers: {
              "content-disposition": "attachment; filename*=UTF-8''runbook.txt",
            },
          }),
        ),
      }),
    );

    await expect(
      client.request(attachmentEndpoints.download, {
        params: { attachmentId: "d9fbf784-e709-4ec4-a2ca-3385e5ff1aa6" },
      }),
    ).resolves.toMatchObject({
      blob: expect.any(Blob),
      contentDisposition: "attachment; filename*=UTF-8''runbook.txt",
    });
  });

  it("uploads signed Worker attachment content as a typed empty-response operation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient(createApiTransport({ fetch }));
    const body = new Blob(["contents"], { type: "text/plain" });
    await expect(
      client.request(attachmentEndpoints.uploadContent, {
        url: "https://mail.example/api/v1/attachments/uploads/d9fbf784-e709-4ec4-a2ca-3385e5ff1aa6/content?token=signed",
        params: { attachmentId: "d9fbf784-e709-4ec4-a2ca-3385e5ff1aa6" },
        headers: { "Content-Type": "text/plain" },
        body,
      }),
    ).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toContain("?token=signed");
    expect(init).toMatchObject({ method: "PUT", body });
    expect(new Headers(init?.headers).get("content-type")).toBe("text/plain");
  });

  it("returns a redirect endpoint location without JSON-envelope decoding", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://provider.example.com/authorize" },
      }),
    );
    const client = createApiClient(
      createApiTransport({
        fetch,
      }),
    );

    await expect(client.request(startProviderAuthorization, {})).resolves.toBe(
      "https://provider.example.com/authorize",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });
});
