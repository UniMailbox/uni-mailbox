import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineEndpoint } from "@unimailbox/contracts";
import { createApiClient } from "./client";

const readMailbox = defineEndpoint({
  method: "GET",
  path: "/mailboxes/:mailboxId",
  request: { params: z.object({ mailboxId: z.string().uuid() }) },
  responses: { 200: z.object({ id: z.string().uuid() }) },
  errors: ["AUTH_REQUIRED", "NOT_FOUND"],
  mediaType: "json",
});

describe("typed API client", () => {
  it("builds encoded paths and validates the selected response schema", async () => {
    const request = vi.fn().mockResolvedValue({ id: "d9fbf784-e709-4ec4-a2ca-3385e5ff1aa6" });
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
    const client = createApiClient({ request: vi.fn().mockResolvedValue({ id: 123 }) } as never);

    await expect(
      client.request(readMailbox, {
        params: { mailboxId: "d9fbf784-e709-4ec4-a2ca-3385e5ff1aa6" },
      }),
    ).rejects.toMatchObject({ code: "CLIENT_RESPONSE_INVALID", status: 200 });
  });
});
