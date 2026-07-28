import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@unimailbox/contracts";
import { IdentityApplicationService } from "../../src/modules/identity/application";
import { PasswordService, TokenService } from "../../src/modules/identity";
import { makeEnv } from "./env-fixture";

const principal: Principal = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.com",
  permissions: new Set(["settings.manage"]),
};

const currentPassword = "current-password-1234";

async function seedIdentity() {
  const password = await new PasswordService().hash(currentPassword);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (
           id, email, password_hash, password_algorithm, password_salt,
           password_iterations, display_name
         ) VALUES (?, ?, ?, ?, ?, ?, 'Administrator')`,
    ).bind(
      principal.userId,
      principal.email,
      password.hash,
      password.algorithm,
      password.salt,
      password.iterations,
    ),
    env.DB.prepare(
      `INSERT INTO users (
           id, email, password_hash, password_algorithm, password_salt,
           password_iterations, display_name
         ) VALUES (?, 'existing@example.com', ?, ?, ?, ?, 'Existing')`,
    ).bind(
      "22222222-2222-4222-8222-222222222222",
      password.hash,
      password.algorithm,
      password.salt,
      password.iterations,
    ),
    env.DB.prepare(
      `INSERT INTO sessions (
           id, user_id, refresh_token_hash, expires_at
         ) VALUES (?, ?, 'refresh-hash', datetime('now', '+1 day'))`,
    ).bind("33333333-3333-4333-8333-333333333333", principal.userId),
  ]);
}

describe("identity-only administrator email changes", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await seedIdentity();
  });

  it("normalizes the login email, leaves mail data alone, and revokes sessions", async () => {
    const identity = new IdentityApplicationService(
      makeEnv(),
      new TokenService("a".repeat(32)),
    );

    await expect(
      identity.changeEmail(
        principal,
        currentPassword,
        "  New.Login@Example.COM ",
      ),
    ).resolves.toEqual({ email: "new.login@example.com" });
    await expect(
      env.DB.prepare("SELECT email FROM users WHERE id = ?")
        .bind(principal.userId)
        .first<{ email: string }>(),
    ).resolves.toEqual({ email: "new.login@example.com" });
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM domains WHERE name = 'example.com'",
      ).first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM mailboxes WHERE owner_user_id = ?",
      )
        .bind(principal.userId)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
    await expect(
      env.DB.prepare("SELECT revoked_at FROM sessions WHERE user_id = ?")
        .bind(principal.userId)
        .first<{ revoked_at: string | null }>(),
    ).resolves.toEqual({ revoked_at: expect.any(String) });
  });

  it("requires the current password and rejects an existing login email", async () => {
    const identity = new IdentityApplicationService(
      makeEnv(),
      new TokenService("a".repeat(32)),
    );

    await expect(
      identity.changeEmail(principal, "wrong-password", "new@example.com"),
    ).rejects.toMatchObject({
      code: "AUTH_CREDENTIALS_INVALID",
      status: 401,
    });
    await expect(
      identity.changeEmail(principal, currentPassword, "existing@example.com"),
    ).rejects.toMatchObject({
      code: "IDENTITY_EMAIL_EXISTS",
      status: 409,
    });
  });
});
