import { describe, expect, it } from "vitest";
import { CursorCodec } from "../../src/modules/messages/cursor";

describe("CursorCodec", () => {
  const key = "cursor-signing-key-".repeat(3);

  it("round-trips a cursor", async () => {
    const codec = new CursorCodec(key);
    const cursor = { createdAt: "2026-07-27 12:00:00.000", id: "abc" };
    const token = await codec.encode(cursor);
    await expect(codec.decode(token)).resolves.toEqual(cursor);
  });

  it("rejects tampered tokens", async () => {
    const codec = new CursorCodec(key);
    const token = await codec.encode({
      createdAt: "2026-07-27 12:00:00.000",
      id: "abc",
    });
    await expect(codec.decode(`${token}x`)).rejects.toMatchObject({
      code: "CURSOR_INVALID",
    });
  });

  it("rejects tokens missing parts", async () => {
    const codec = new CursorCodec(key);
    await expect(codec.decode("only-part")).rejects.toMatchObject({
      code: "CURSOR_INVALID",
    });
  });

  it("rejects tokens whose payload is malformed", async () => {
    const codec = new CursorCodec(key);
    const payload = btoa("not-json")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    const signatureBytes = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(key),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
        new TextEncoder().encode(payload),
      ),
    );
    const signature = btoa(String.fromCharCode(...signatureBytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    await expect(codec.decode(`${payload}.${signature}`)).rejects.toMatchObject(
      {
        code: "CURSOR_INVALID",
      },
    );
  });

  it("rejects tokens whose payload is missing required fields", async () => {
    const codec = new CursorCodec(key);
    const token = await codec.encode({
      createdAt: "2026-07-27 12:00:00.000",
      id: "abc",
    });
    const [, signature] = token.split(".");
    const malformed = btoa(JSON.stringify({ id: 1 }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    await expect(
      codec.decode(`${malformed}.${signature}`),
    ).rejects.toMatchObject({ code: "CURSOR_INVALID" });
  });
});
