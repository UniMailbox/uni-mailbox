import type { ApiResult, SessionPayload } from "@cf-startup/shared";
import { describe, expect, it } from "vitest";
import app from "../src/index";

const env = {
  APP_ENV: "test",
  ALLOWED_ORIGIN: "http://localhost:5173",
  DB: {} as D1Database,
  APP_KV: {} as KVNamespace,
  FILE_BUCKET: {} as R2Bucket
};

describe("api auth", () => {
  it("returns a viewer session by default", async () => {
    const response = await app.request("/session", {}, env);
    const body = (await response.json()) as ApiResult<SessionPayload>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    if (!body.ok) {
      throw new Error(body.error.message);
    }
    expect(body.data.role).toBe("viewer");
    expect(body.data.permissions).toContain("profile:read");
  });

  it("blocks config access for non-admin roles", async () => {
    const response = await app.request("/config/theme", {}, env);

    expect(response.status).toBe(403);
  });
});
