import { describe, expect, it } from "vitest";
import { createAppQueryClient, createTestQueryClient } from "./query-client";

describe("query client policy", () => {
  it("uses the production freshness and retry policy", () => {
    const client = createAppQueryClient();
    expect(client.getDefaultOptions().queries).toMatchObject({
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true,
    });
  });

  it("disables retries in tests", () => {
    const client = createTestQueryClient();
    expect(client.getDefaultOptions().queries?.retry).toBe(false);
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
  });
});
