import {
  ADMINISTRATOR_PERMISSIONS,
  DomainError,
  MEMBER_PERMISSIONS,
  PERMISSION_KEYS,
  type PermissionKey,
  type Principal,
} from "@unimailbox/contracts";
import { runtimePolicy } from "@unimailbox/config";
import type { Env } from "../../platform/config";
import {
  PasswordService,
  hashRefreshToken,
  normalizeEmail,
  type PasswordRecord,
} from "./index";
import type { TokenService } from "./index";

const ADMIN_ROLE_ID = "00000000-0000-4000-8000-000000000001";
const MEMBER_ROLE_ID = "00000000-0000-4000-8000-000000000002";

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_algorithm: "pbkdf2-sha256";
  password_salt: string;
  password_iterations: number;
  status: "active" | "suspended" | "deleted";
}

interface SessionRow {
  id: string;
  user_id: string;
  email: string;
  status: "active" | "suspended" | "deleted";
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

function d1Timestamp(date: Date): string {
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/u, "");
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export class IdentityApplicationService {
  private readonly passwords = new PasswordService();

  constructor(
    private readonly env: Env,
    private readonly tokens: TokenService,
  ) {}

  verifyAccessToken(token: string): Promise<Principal> {
    return this.tokens.verifyAccessToken(token);
  }

  async createFirstAdministrator(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ userId: string }> {
    const existing = await this.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM users",
    ).first<{ count: number }>();
    if ((existing?.count ?? 0) !== 0) {
      throw new DomainError(
        "ADMINISTRATOR_ALREADY_EXISTS",
        "The first administrator has already been created",
        409,
      );
    }
    const userId = crypto.randomUUID();
    const record = await this.passwords.hash(input.password);
    await this.env.DB.batch([
      this.insertUserStatement({
        id: userId,
        email: normalizeEmail(input.email),
        displayName: input.displayName,
        record,
      }),
      this.env.DB.prepare(
        "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
      ).bind(userId, ADMIN_ROLE_ID),
    ]);
    return { userId };
  }

  async register(
    input: {
      email: string;
      password: string;
      displayName: string;
      registrationKey?: string;
    },
    request?: Request,
  ): Promise<{ userId: string }> {
    if (request) {
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      await this.enforceRateLimit(
        `rate:register:${await digest(ip)}`,
        5,
        3600,
        "REGISTRATION_RATE_LIMITED",
      );
    }
    const settings = await this.env.DB.prepare(
      `SELECT registration_enabled, invite_required
       FROM system_settings WHERE id = 1`,
    ).first<{ registration_enabled: number; invite_required: number }>();
    if (!settings || settings.registration_enabled !== 1) {
      throw new DomainError(
        "REGISTRATION_DISABLED",
        "Registration is disabled",
        403,
      );
    }

    let invitationId: string | null = null;
    if (settings.invite_required === 1) {
      if (!input.registrationKey) {
        throw new DomainError(
          "REGISTRATION_KEY_REQUIRED",
          "A registration key is required",
          403,
        );
      }
      const keyHash = await digest(input.registrationKey);
      const invitation = await this.env.DB.prepare(
        `SELECT id
         FROM registration_keys
         WHERE code_hash = ? AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
           AND used_count < max_uses`,
      )
        .bind(keyHash)
        .first<{ id: string }>();
      if (!invitation) {
        throw new DomainError(
          "REGISTRATION_KEY_INVALID",
          "The registration key is invalid or expired",
          403,
        );
      }
      invitationId = invitation.id;
    }

    const userId = crypto.randomUUID();
    const record = await this.passwords.hash(input.password);
    const statements = [
      this.insertUserStatement({
        id: userId,
        email: normalizeEmail(input.email),
        displayName: input.displayName,
        record,
      }),
      this.env.DB.prepare(
        "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
      ).bind(userId, MEMBER_ROLE_ID),
      ...(invitationId
        ? [
            this.env.DB.prepare(
              `UPDATE registration_keys
               SET used_count = used_count + 1
               WHERE id = ? AND used_count < max_uses`,
            ).bind(invitationId),
          ]
        : []),
    ];
    try {
      await this.env.DB.batch(statements);
    } catch {
      throw new DomainError(
        "USER_EMAIL_CONFLICT",
        "An account with this email already exists",
        409,
      );
    }
    return { userId };
  }

  async login(
    input: { email: string; password: string },
    request: Request,
  ): Promise<AuthTokens> {
    const email = normalizeEmail(input.email);
    await this.enforceLoginRateLimit(email, request);
    const user = await this.env.DB.prepare(
      `SELECT id, email, display_name, password_hash, password_algorithm,
              password_salt, password_iterations, status
       FROM users WHERE email = ? COLLATE NOCASE`,
    )
      .bind(email)
      .first<UserRow>();
    if (!user || user.status !== "active") {
      throw new DomainError(
        "AUTH_CREDENTIALS_INVALID",
        "The email or password is incorrect",
        401,
      );
    }
    const record: PasswordRecord = {
      hash: user.password_hash,
      salt: user.password_salt,
      algorithm: user.password_algorithm,
      iterations: user.password_iterations,
    };
    const verification = await this.passwords.verify(input.password, record);
    if (!verification.valid) {
      throw new DomainError(
        "AUTH_CREDENTIALS_INVALID",
        "The email or password is incorrect",
        401,
      );
    }
    if (verification.needsRehash) {
      const stronger = await this.passwords.hash(input.password);
      await this.env.DB.prepare(
        `UPDATE users
         SET password_hash = ?, password_algorithm = ?, password_salt = ?,
             password_iterations = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
        .bind(
          stronger.hash,
          stronger.algorithm,
          stronger.salt,
          stronger.iterations,
          user.id,
        )
        .run();
    }
    return this.createSession(user.id, user.email, request);
  }

  async refresh(refreshToken: string, request: Request): Promise<AuthTokens> {
    const currentHash = await hashRefreshToken(refreshToken);
    const session = await this.env.DB.prepare(
      `SELECT s.id, s.user_id, u.email, u.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = ? AND s.revoked_at IS NULL
         AND s.expires_at > CURRENT_TIMESTAMP`,
    )
      .bind(currentHash)
      .first<SessionRow>();
    if (!session || session.status !== "active") {
      throw new DomainError(
        "REFRESH_TOKEN_INVALID",
        "The refresh token is invalid or expired",
        401,
      );
    }
    const next = await this.tokens.createRefreshToken();
    const expiresAt = new Date(
      Date.now() + runtimePolicy.refreshTokenTtlSeconds * 1000,
    );
    const rotated = await this.env.DB.prepare(
      `UPDATE sessions
       SET refresh_token_hash = ?, expires_at = ?, ip_address = ?,
           user_agent = ?
       WHERE id = ? AND refresh_token_hash = ? AND revoked_at IS NULL`,
    )
      .bind(
        next.hash,
        d1Timestamp(expiresAt),
        request.headers.get("cf-connecting-ip"),
        request.headers.get("user-agent"),
        session.id,
        currentHash,
      )
      .run();
    if (rotated.meta.changes !== 1) {
      throw new DomainError(
        "REFRESH_TOKEN_REUSED",
        "The refresh token has already been rotated",
        401,
      );
    }
    return {
      accessToken: await this.tokens.createAccessToken({
        userId: session.user_id,
        email: session.email,
        permissions: await this.permissionsForUser(session.user_id),
      }),
      accessTokenExpiresIn: runtimePolicy.accessTokenTtlSeconds,
      refreshToken: next.token,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
       WHERE refresh_token_hash = ? AND revoked_at IS NULL`,
    )
      .bind(await hashRefreshToken(refreshToken))
      .run();
  }

  async logoutAll(userId: string): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND revoked_at IS NULL`,
    )
      .bind(userId)
      .run();
  }

  async resetPassword(
    principal: Principal,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.env.DB.prepare(
      `SELECT id, email, display_name, password_hash, password_algorithm,
              password_salt, password_iterations, status
       FROM users WHERE id = ?`,
    )
      .bind(principal.userId)
      .first<UserRow>();
    if (!user) {
      throw new DomainError("USER_NOT_FOUND", "User not found", 404);
    }
    const valid = await this.passwords.verify(currentPassword, {
      hash: user.password_hash,
      salt: user.password_salt,
      algorithm: user.password_algorithm,
      iterations: user.password_iterations,
    });
    if (!valid.valid) {
      throw new DomainError(
        "AUTH_CREDENTIALS_INVALID",
        "The current password is incorrect",
        401,
      );
    }
    const next = await this.passwords.hash(newPassword);
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE users
         SET password_hash = ?, password_algorithm = ?, password_salt = ?,
             password_iterations = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).bind(
        next.hash,
        next.algorithm,
        next.salt,
        next.iterations,
        principal.userId,
      ),
      this.env.DB.prepare(
        `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND revoked_at IS NULL`,
      ).bind(principal.userId),
    ]);
  }

  async changeEmail(
    principal: Principal,
    currentPassword: string,
    email: string,
  ): Promise<{ email: string }> {
    const user = await this.env.DB.prepare(
      `SELECT id, email, display_name, password_hash, password_algorithm,
              password_salt, password_iterations, status
       FROM users WHERE id = ?`,
    )
      .bind(principal.userId)
      .first<UserRow>();
    if (!user) {
      throw new DomainError("USER_NOT_FOUND", "User not found", 404);
    }
    const verification = await this.passwords.verify(currentPassword, {
      hash: user.password_hash,
      salt: user.password_salt,
      algorithm: user.password_algorithm,
      iterations: user.password_iterations,
    });
    if (!verification.valid) {
      throw new DomainError(
        "AUTH_CREDENTIALS_INVALID",
        "The current password is incorrect",
        401,
      );
    }
    const normalizedEmail = normalizeEmail(email);
    try {
      await this.env.DB.batch([
        this.env.DB.prepare(
          `UPDATE users
           SET email = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).bind(normalizedEmail, principal.userId),
        this.env.DB.prepare(
          `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND revoked_at IS NULL`,
        ).bind(principal.userId),
      ]);
    } catch {
      throw new DomainError(
        "IDENTITY_EMAIL_EXISTS",
        "An account with this login email already exists",
        409,
      );
    }
    return { email: normalizedEmail };
  }

  private insertUserStatement(input: {
    id: string;
    email: string;
    displayName: string;
    record: PasswordRecord;
  }): D1PreparedStatement {
    return this.env.DB.prepare(
      `INSERT INTO users (
         id, email, password_hash, password_algorithm, password_salt,
         password_iterations, status, display_name
       ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    ).bind(
      input.id,
      input.email,
      input.record.hash,
      input.record.algorithm,
      input.record.salt,
      input.record.iterations,
      input.displayName,
    );
  }

  private async createSession(
    userId: string,
    email: string,
    request: Request,
  ): Promise<AuthTokens> {
    const refresh = await this.tokens.createRefreshToken();
    const expiresAt = new Date(
      Date.now() + runtimePolicy.refreshTokenTtlSeconds * 1000,
    );
    await this.env.DB.prepare(
      `INSERT INTO sessions (
         id, user_id, refresh_token_hash, expires_at, ip_address, user_agent
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        userId,
        refresh.hash,
        d1Timestamp(expiresAt),
        request.headers.get("cf-connecting-ip"),
        request.headers.get("user-agent"),
      )
      .run();
    return {
      accessToken: await this.tokens.createAccessToken({
        userId,
        email,
        permissions: await this.permissionsForUser(userId),
      }),
      accessTokenExpiresIn: runtimePolicy.accessTokenTtlSeconds,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  private async permissionsForUser(userId: string): Promise<PermissionKey[]> {
    const result = await this.env.DB.prepare(
      `SELECT DISTINCT rp.permission_key
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       WHERE ur.user_id = ?`,
    )
      .bind(userId)
      .all<{ permission_key: string }>();
    const valid = new Set<string>(PERMISSION_KEYS);
    return result.results
      .map((row) => row.permission_key)
      .filter((key): key is PermissionKey => valid.has(key));
  }

  private async enforceLoginRateLimit(
    email: string,
    request: Request,
  ): Promise<void> {
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const key = `rate:login:${await digest(`${email}:${ip}`)}`;
    await this.enforceRateLimit(key, 10, 900, "LOGIN_RATE_LIMITED");
  }

  private async enforceRateLimit(
    key: string,
    maximum: number,
    ttl: number,
    code: string,
  ): Promise<void> {
    const attempts = Number.parseInt((await this.env.KV.get(key)) ?? "0", 10);
    if (attempts >= maximum) {
      throw new DomainError(code, "Too many requests", 429);
    }
    await this.env.KV.put(key, String(attempts + 1), { expirationTtl: ttl });
  }
}

export const identityRoleDefaults = {
  administrator: ADMINISTRATOR_PERMISSIONS,
  member: MEMBER_PERMISSIONS,
} as const;
