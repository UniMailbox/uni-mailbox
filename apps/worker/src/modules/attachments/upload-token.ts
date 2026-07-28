import { DomainError } from "@unimailbox/contracts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface UploadTokenClaims {
  uploadId: string;
  objectKey: string;
  contentType: string;
  filename: string;
  disposition: "attachment" | "inline";
  size: number;
  expiresAt: number;
}

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

export class UploadTokenCodec {
  constructor(private readonly signingKey: string) {}

  async encode(claims: UploadTokenClaims): Promise<string> {
    const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
    const signature = await crypto.subtle.sign(
      "HMAC",
      await this.key(),
      encoder.encode(payload),
    );
    return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
  }

  async decode(token: string): Promise<UploadTokenClaims> {
    try {
      const [payload, signature] = token.split(".");
      if (!payload || !signature) throw new Error("missing token parts");
      const verified = await crypto.subtle.verify(
        "HMAC",
        await this.key(),
        fromBase64Url(signature),
        encoder.encode(payload),
      );
      if (!verified) throw new Error("invalid signature");
      const claims = JSON.parse(
        decoder.decode(fromBase64Url(payload)),
      ) as UploadTokenClaims;
      if (
        typeof claims.uploadId !== "string" ||
        typeof claims.objectKey !== "string" ||
        typeof claims.contentType !== "string" ||
        typeof claims.filename !== "string" ||
        !["attachment", "inline"].includes(claims.disposition) ||
        !Number.isSafeInteger(claims.size) ||
        !Number.isSafeInteger(claims.expiresAt) ||
        claims.expiresAt <= Date.now()
      ) {
        throw new Error("invalid claims");
      }
      return claims;
    } catch {
      throw new DomainError(
        "ATTACHMENT_UPLOAD_TOKEN_INVALID",
        "The attachment upload token is invalid or expired",
        401,
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
