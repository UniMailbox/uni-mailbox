import { describe, expect, it } from "vitest";
import { hashRefreshToken, TokenService } from "../../src/modules/identity";

const signingKey = "a".repeat(64);

async function signPayload(
  key: string,
  header: string,
  payload: string,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return base64Url(new Uint8Array(signature));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

describe("TokenService additional cases", () => {
  it("requires a 32+ character signing key", () => {
    expect(() => new TokenService("short-key")).toThrowError(
      /AUTH_SIGNING_KEY/,
    );
  });

  it("rejects a token with the wrong segment count", async () => {
    const service = new TokenService(signingKey);
    await expect(service.verifyAccessToken("not.a.token.bad")).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    });
  });

  it("rejects an expired access token", async () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const service = new TokenService(signingKey, () => now);
    const token = await service.createAccessToken({
      userId: "user-1",
      email: "user@example.com",
      permissions: ["message.read"],
    });

    const futureService = new TokenService(signingKey, () => new Date("2026-08-01T00:00:00.000Z"));
    await expect(futureService.verifyAccessToken(token)).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    });
  });

  it("rejects a token whose payload is not a valid access payload", async () => {
    const service = new TokenService(signingKey);
    const header = base64Url(
      new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    );
    const payload = base64Url(
      new TextEncoder().encode(
        JSON.stringify({ iat: 0, exp: 9999999999, type: "refresh" }),
      ),
    );
    const signatureBase64 = await signPayload(signingKey, header, payload);

    await expect(
      service.verifyAccessToken(`${header}.${payload}.${signatureBase64}`),
    ).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  });

  it("rejects unknown permissions in the token payload", async () => {
    const service = new TokenService(signingKey);
    const header = base64Url(
      new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    );
    const payload = base64Url(
      new TextEncoder().encode(
        JSON.stringify({
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
          type: "access",
          userId: "user-1",
          email: "user@example.com",
          permissions: ["message.unknown"],
        }),
      ),
    );
    const signatureBase64 = await signPayload(signingKey, header, payload);

    await expect(
      service.verifyAccessToken(`${header}.${payload}.${signatureBase64}`),
    ).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  });

  it("issues opaque refresh tokens whose hash matches", async () => {
    const service = new TokenService(signingKey);
    const refresh = await service.createRefreshToken();
    expect(refresh.token).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(refresh.hash).toBe(await hashRefreshToken(refresh.token));
  });

  it("rejects a payload that fails to decode as JSON", async () => {
    const service = new TokenService(signingKey);
    const header = base64Url(
      new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    );
    const payload = base64Url(new TextEncoder().encode("not-json"));
    const signatureBase64 = await signPayload(signingKey, header, payload);

    await expect(
      service.verifyAccessToken(`${header}.${payload}.${signatureBase64}`),
    ).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  });

  it("rejects a payload whose permission list contains a non-string", async () => {
    const service = new TokenService(signingKey);
    const header = base64Url(
      new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    );
    const payload = base64Url(
      new TextEncoder().encode(
        JSON.stringify({
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
          type: "access",
          userId: "user-1",
          email: "user@example.com",
          permissions: [42],
        }),
      ),
    );
    const signatureBase64 = await signPayload(signingKey, header, payload);

    await expect(
      service.verifyAccessToken(`${header}.${payload}.${signatureBase64}`),
    ).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  });
});

describe("hashRefreshToken", () => {
  it("is deterministic for the same input", async () => {
    const token = "fixed-refresh-token";
    expect(await hashRefreshToken(token)).toBe(await hashRefreshToken(token));
  });

  it("returns different hashes for different tokens", async () => {
    const a = await hashRefreshToken("token-a");
    const b = await hashRefreshToken("token-b");
    expect(a).not.toBe(b);
  });
});

describe("PasswordService edge cases", () => {
  it("rejects password records with an unknown algorithm", async () => {
    const service = new (
      await import("../../src/modules/identity")
    ).PasswordService({ iterations: 1000 });
    const result = await service.verify("password", {
      hash: btoa("AAAA"),
      salt: btoa("BBBB"),
      algorithm: "argon2" as unknown as "pbkdf2-sha256",
      iterations: 1000,
    });
    expect(result).toEqual({ valid: false, needsRehash: false });
  });

  it("rejects password records with non-positive iterations", async () => {
    const service = new (
      await import("../../src/modules/identity")
    ).PasswordService({ iterations: 1000 });
    const result = await service.verify("password", {
      hash: btoa("AAAA"),
      salt: btoa("BBBB"),
      algorithm: "pbkdf2-sha256",
      iterations: 0,
    });
    expect(result).toEqual({ valid: false, needsRehash: false });
  });

  it("rejects records where the hash byte length differs", async () => {
    const service = new (
      await import("../../src/modules/identity")
    ).PasswordService({ iterations: 1000 });
    const record = await service.hash("password");
    const tampered = { ...record, hash: btoa("AAAA") };
    const result = await service.verify("password", tampered);
    expect(result).toEqual({ valid: false, needsRehash: false });
  });

  it("rejects records whose iterations are not a safe integer", async () => {
    const service = new (
      await import("../../src/modules/identity")
    ).PasswordService({ iterations: 1000 });
    const record = await service.hash("password");
    const tampered = {
      ...record,
      iterations: Number.MAX_SAFE_INTEGER + 2,
    };
    const result = await service.verify("password", tampered);
    expect(result).toEqual({ valid: false, needsRehash: false });
  });
});