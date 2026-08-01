import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { request, setAccessToken } = vi.hoisted(() => ({
  request: vi.fn(),
  setAccessToken: vi.fn(),
}));

vi.mock("../../lib/api/index", () => ({
  apiClient: { request },
  setAccessToken,
}));

import {
  authKeys,
  loginMutationOptions,
  logoutMutationOptions,
  sessionQueryOptions,
} from "./api";

describe("auth query options", () => {
  beforeEach(() => {
    request.mockReset();
    setAccessToken.mockReset();
  });

  it("reads the canonical session key without retrying an unauthenticated response", () => {
    const options = sessionQueryOptions();
    expect(options.queryKey).toEqual(["auth", "session"]);
    expect(options.staleTime).toBe(15_000);
    expect(options.retry).toBe(false);
  });

  it("stores a login token and invalidates exactly the session query", async () => {
    const client = new QueryClient();
    request.mockResolvedValue({
      accessToken: "token-1",
      accessTokenExpiresIn: 900,
      refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const options = loginMutationOptions(client);
    const context = { client, meta: undefined };

    const result = await options.mutationFn!(
      {
        email: "operator@example.com",
        password: "correct horse battery staple",
      },
      context,
    );
    await options.onSuccess!(
      result,
      {
        email: "operator@example.com",
        password: "correct horse battery staple",
      },
      undefined,
      context,
    );

    expect(setAccessToken).toHaveBeenCalledWith("token-1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: authKeys.session() });
  });

  it("clears the access token and cached remote records after logout", async () => {
    const client = new QueryClient();
    client.setQueryData(["mailboxes"], [{ id: "mailbox-1" }]);
    request.mockResolvedValue({ revoked: true });
    const options = logoutMutationOptions(client);
    const context = { client, meta: undefined };

    const result = await options.mutationFn!(undefined, context);
    await options.onSuccess!(result, undefined, undefined, context);

    expect(setAccessToken).toHaveBeenCalledWith(null);
    expect(client.getQueryData(["mailboxes"])).toBeUndefined();
  });
});
