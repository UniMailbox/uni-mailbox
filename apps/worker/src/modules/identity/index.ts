import {
  DomainError,
  PERMISSION_KEYS,
  type PermissionKey,
  type Principal,
} from "@unimailbox/contracts";
import { runtimePolicy } from "@unimailbox/config";

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
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export interface PasswordRecord {
  hash: string;
  salt: string;
  algorithm: "pbkdf2-sha256";
  iterations: number;
}

export class PasswordService {
  constructor(
    private readonly policy: { iterations: number } = {
      iterations: runtimePolicy.passwordIterations,
    },
  ) {}

  async hash(password: string): Promise<PasswordRecord> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return {
      hash: toBase64Url(
        await this.derive(password, salt, this.policy.iterations),
      ),
      salt: toBase64Url(salt),
      algorithm: "pbkdf2-sha256",
      iterations: this.policy.iterations,
    };
  }

  async verify(
    password: string,
    record: PasswordRecord,
  ): Promise<{ valid: boolean; needsRehash: boolean }> {
    if (
      record.algorithm !== "pbkdf2-sha256" ||
      !Number.isSafeInteger(record.iterations) ||
      record.iterations <= 0
    ) {
      return { valid: false, needsRehash: false };
    }

    const expected = fromBase64Url(record.hash);
    const actual = await this.derive(
      password,
      fromBase64Url(record.salt),
      record.iterations,
    );
    if (expected.byteLength !== actual.byteLength) {
      return { valid: false, needsRehash: false };
    }

    let difference = 0;
    for (let index = 0; index < expected.byteLength; index += 1) {
      difference |= expected[index] ^ actual[index];
    }

    return {
      valid: difference === 0,
      needsRehash:
        difference === 0 && record.iterations < this.policy.iterations,
    };
  }

  private async derive(
    password: string,
    salt: Uint8Array,
    iterations: number,
  ): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations,
      },
      key,
      256,
    );
    return new Uint8Array(bits);
  }
}

interface AccessTokenInput {
  userId: string;
  email: string;
  permissions: readonly PermissionKey[];
}

interface AccessTokenPayload extends AccessTokenInput {
  iat: number;
  exp: number;
  type: "access";
}

export class TokenService {
  constructor(
    private readonly signingKey: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (signingKey.length < 32) {
      throw new Error("AUTH_SIGNING_KEY must be at least 32 characters");
    }
  }

  async createAccessToken(input: AccessTokenInput): Promise<string> {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const header = toBase64Url(
      encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    );
    const payload = toBase64Url(
      encoder.encode(
        JSON.stringify({
          ...input,
          iat: issuedAt,
          exp: issuedAt + runtimePolicy.accessTokenTtlSeconds,
          type: "access",
        } satisfies AccessTokenPayload),
      ),
    );
    const unsigned = `${header}.${payload}`;
    return `${unsigned}.${await this.sign(unsigned)}`;
  }

  async verifyAccessToken(token: string): Promise<Principal> {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw this.invalidToken();
    }
    const [header, payload, signature] = parts;
    const key = await this.importKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      encoder.encode(`${header}.${payload}`),
    );
    if (!valid) throw this.invalidToken();

    try {
      const parsed = JSON.parse(
        decoder.decode(fromBase64Url(payload)),
      ) as AccessTokenPayload;
      const now = Math.floor(this.now().getTime() / 1000);
      if (
        parsed.type !== "access" ||
        parsed.exp <= now ||
        parsed.iat > now + 60 ||
        typeof parsed.userId !== "string" ||
        typeof parsed.email !== "string" ||
        !Array.isArray(parsed.permissions)
      ) {
        throw this.invalidToken();
      }

      const declared = new Set<string>(PERMISSION_KEYS);
      if (parsed.permissions.some((permission) => !declared.has(permission))) {
        throw this.invalidToken();
      }

      return {
        userId: parsed.userId,
        email: normalizeEmail(parsed.email),
        permissions: new Set(parsed.permissions),
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw this.invalidToken();
    }
  }

  async createRefreshToken(): Promise<{
    token: string;
    hash: string;
  }> {
    const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    return { token, hash: await hashRefreshToken(token) };
  }

  private async sign(value: string): Promise<string> {
    const signature = await crypto.subtle.sign(
      "HMAC",
      await this.importKey(),
      encoder.encode(value),
    );
    return toBase64Url(new Uint8Array(signature));
  }

  private importKey(): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      encoder.encode(this.signingKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }

  private invalidToken(): DomainError {
    return new DomainError(
      "AUTH_TOKEN_INVALID",
      "The access token is invalid or expired",
      401,
    );
  }
}

export async function hashRefreshToken(token: string): Promise<string> {
  return toBase64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(token)),
    ),
  );
}
