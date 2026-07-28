import { describe, expect, it } from "vitest";
import {
  PasswordService,
  TokenService,
  normalizeEmail,
} from "../../src/modules/identity";

const signingKey = "a".repeat(64);

describe("identity cryptography", () => {
  it("normalizes identity email addresses", () => {
    expect(normalizeEmail("  Admin@Example.COM ")).toBe("admin@example.com");
  });

  it("hashes and verifies passwords without storing the raw password", async () => {
    const service = new PasswordService({ iterations: 10_000 });
    const record = await service.hash("correct horse battery staple");

    expect(record.hash).not.toContain("correct horse");
    expect(record.salt).not.toHaveLength(0);
    expect(record.algorithm).toBe("pbkdf2-sha256");
    await expect(
      service.verify("correct horse battery staple", record),
    ).resolves.toEqual({ valid: true, needsRehash: false });
    await expect(service.verify("incorrect", record)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("marks weaker password records for rehash", async () => {
    const weak = new PasswordService({ iterations: 1_000 });
    const active = new PasswordService({ iterations: 10_000 });
    const record = await weak.hash("correct horse battery staple");

    await expect(
      active.verify("correct horse battery staple", record),
    ).resolves.toEqual({ valid: true, needsRehash: true });
  });

  it("creates verifiable 15-minute access tokens and rejects tampering", async () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const service = new TokenService(signingKey, () => now);
    const token = await service.createAccessToken({
      userId: "63f9c510-00c3-48b6-95f8-cda4ef3439f0",
      email: "admin@example.com",
      permissions: ["message.read"],
    });

    await expect(service.verifyAccessToken(token)).resolves.toMatchObject({
      userId: "63f9c510-00c3-48b6-95f8-cda4ef3439f0",
      email: "admin@example.com",
    });
    await expect(
      service.verifyAccessToken(`${token.slice(0, -1)}x`),
    ).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID", status: 401 });
  });
});
