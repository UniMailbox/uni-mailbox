import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError } from "./api";
import { apiRequest, getAccessToken, setAccessToken } from "./api";

describe("API client", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("attaches the in-memory access token without persisting it", async () => {
    setAccessToken("access-token");
    const fetchMock = vi
      .spyOn(window, "fetch")
      .mockResolvedValue(Response.json({ data: { ok: true } }));

    await apiRequest("/mailboxes");

    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(getAccessToken()).toBe("access-token");
    expect(window.localStorage.getItem("unimailbox.access-token")).toBeNull();
  });

  it("maps structured server failures to ApiError", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      Response.json(
        {
          error: {
            code: "PERMISSION_DENIED",
            message: "Permission required",
            requestId: "request-1",
          },
        },
        { status: 403 },
      ),
    );

    await expect(apiRequest("/admin/users", {}, false)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403,
    } satisfies Partial<ApiError>);
  });
});
