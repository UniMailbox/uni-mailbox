import { DomainError } from "@unimailbox/contracts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (item) => item.charCodeAt(0));
}

export interface MessageCursor {
  createdAt: string;
  id: string;
}

export class CursorCodec {
  constructor(private readonly signingKey: string) {}

  async encode(cursor: MessageCursor): Promise<string> {
    const payload = toBase64Url(encoder.encode(JSON.stringify(cursor)));
    const signature = await crypto.subtle.sign(
      "HMAC",
      await this.key(),
      encoder.encode(payload),
    );
    return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
  }

  async decode(value: string): Promise<MessageCursor> {
    try {
      const [payload, signature] = value.split(".");
      if (!payload || !signature) throw new Error("missing cursor parts");
      const valid = await crypto.subtle.verify(
        "HMAC",
        await this.key(),
        fromBase64Url(signature),
        encoder.encode(payload),
      );
      if (!valid) throw new Error("invalid cursor signature");
      const parsed = JSON.parse(
        decoder.decode(fromBase64Url(payload)),
      ) as MessageCursor;
      if (
        typeof parsed.createdAt !== "string" ||
        typeof parsed.id !== "string"
      ) {
        throw new Error("invalid cursor payload");
      }
      return parsed;
    } catch {
      throw new DomainError(
        "CURSOR_INVALID",
        "The pagination cursor is invalid",
      );
    }
  }

  private key(): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      encoder.encode(this.signingKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
}
