import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMINISTRATOR_PERMISSIONS,
  BREVO_PROVIDER_KEY,
  type Principal,
  type ProviderKey,
  type ProviderPlugin,
} from "@unimailbox/contracts";
import { AdminApplicationService } from "../../src/modules/administration";
import { ProviderRegistry } from "../../src/integrations/providers";
import { createBrevoProviderPlugin } from "../../src/integrations/brevo";
import { CredentialCipher } from "../../src/platform/crypto";

const cipher = new CredentialCipher("e".repeat(32));

const administrator: Principal = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.com",
  permissions: new Set(ADMINISTRATOR_PERMISSIONS),
};

function service() {
  const brevoPlugin: ProviderPlugin = createBrevoProviderPlugin(vi.fn());
  const envRecord = env as unknown as Record<string, unknown>;
  const baseEnv = {
    DB: env.DB,
    KV: env.KV,
    ATTACHMENTS: envRecord.ATTACHMENTS as R2Bucket | undefined,
    OUTBOUND_QUEUE: env.OUTBOUND_QUEUE,
    ASSETS: {} as Fetcher,
    INSTALLATION_TOKEN: "x".repeat(32),
    AUTH_SIGNING_KEY: "x".repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: "e".repeat(32),
  };
  return new AdminApplicationService({
    env: baseEnv,
    providers: new ProviderRegistry(
      new Map<ProviderKey, ProviderPlugin>([[BREVO_PROVIDER_KEY, brevoPlugin]]),
    ),
    credentials: cipher,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
}

async function seedAdministrator() {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (
         id, email, password_hash, password_salt, password_iterations,
         display_name
       ) VALUES (?, 'admin@example.com', 'hash', 'salt', 1, 'Admin')`,
    ).bind("11111111-1111-4111-8111-111111111111"),
    env.DB.prepare(
      `INSERT INTO users (
         id, email, password_hash, password_salt, password_iterations,
         display_name
       ) VALUES (?, 'member@example.com', 'hash', 'salt', 1, 'Member')`,
    ).bind("22222222-2222-4222-8222-222222222222"),
    env.DB.prepare(
      `INSERT INTO users (
         id, email, password_hash, password_salt, password_iterations,
         display_name
       ) VALUES (?, 'inactive@example.com', 'hash', 'salt', 1, 'Inactive')`,
    ).bind("33333333-3333-4333-8333-333333333333"),
    env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(
      "33333333-3333-4333-8333-333333333333",
    ),
  ]);
}

describe("AdminApplicationService user and role management", () => {
  beforeEach(async () => {
    await seedAdministrator();
  });

  it("lists users and roles", async () => {
    const users = await service().listUsers(administrator);
    const roles = await service().listRoles(administrator);
    expect(users.length).toBeGreaterThan(0);
    expect(roles.length).toBeGreaterThan(0);
  });

  it("creates, updates, and deletes a user", async () => {
    const admin = service();
    const created = await admin.createUser(administrator, {
      email: "newuser@example.com",
      password: "strong-password-1234",
      displayName: "New User",
      roleIds: [],
    });
    await admin.updateUser(administrator, created.id, {
      displayName: "Renamed",
      status: "suspended",
      roleIds: [],
    });
    await admin.deleteUser(administrator, created.id);
  });

  it("forbids an administrator from deleting themselves", async () => {
    await expect(
      service().deleteUser(administrator, administrator.userId),
    ).rejects.toMatchObject({ code: "USER_SELF_DELETE_FORBIDDEN" });
  });

  it("creates and updates a custom role", async () => {
    const admin = service();
    const role = await admin.createRole(administrator, {
      name: `Auditor-${crypto.randomUUID()}`,
      description: "Read-only auditor",
      permissions: ["user.read", "role.read"],
    });
    const updated = await admin.updateRole(administrator, role.id, {
      description: "Auditor with analytics access",
      permissions: ["user.read", "analytics.read"],
    });
    expect(updated.permissions).toEqual(["user.read", "analytics.read"]);
    const all = await env.DB.prepare(
      "SELECT id, name, is_system FROM roles ORDER BY id",
    ).all<{ id: string; name: string; is_system: number }>();
    const found = all.results.filter((row) => row.id === role.id);
    expect(found).toHaveLength(1);
    expect(found[0]?.is_system).toBe(0);
    await env.DB.prepare("DELETE FROM roles WHERE id = ?").bind(role.id).run();
  });

  it("rejects invalid permissions when creating a role", async () => {
    await expect(
      service().createRole(administrator, {
        name: "Bad",
        description: "Invalid",
        permissions: ["not.a.permission"],
      }),
    ).rejects.toMatchObject({ code: "ROLE_PERMISSION_INVALID" });
  });

  it("forbids updating or deleting system roles", async () => {
    const admin = service();
    const systemRoleId = await env.DB.prepare(
      "SELECT id FROM roles WHERE is_system = 1 LIMIT 1",
    )
      .first<{ id: string }>()
      .then((row) => row?.id ?? "");
    await expect(
      admin.updateRole(administrator, systemRoleId, {
        description: "tweak",
        permissions: ["user.read"],
      }),
    ).rejects.toMatchObject({ code: "SYSTEM_ROLE_IMMUTABLE" });
  });
});

describe("AdminApplicationService domains and signatures", () => {
  beforeEach(async () => {
    await seedAdministrator();
  });

  it("creates, updates, and deletes domains", async () => {
    const admin = service();
    const created = await admin.createDomain(administrator, "example.com");
    const updated = await admin.updateDomain(administrator, created.id, {
      status: "disabled",
    });
    expect(updated.status).toBe("disabled");
    await expect(
      admin.deleteDomain(administrator, created.id),
    ).resolves.toBeUndefined();
  });

  it("forbids deleting a domain that still has mailboxes", async () => {
    const admin = service();
    const domain = await admin.createDomain(
      administrator,
      "active.example.com",
    );
    await env.DB.prepare(
      `INSERT INTO mailboxes (
         id, domain_id, owner_user_id, address, display_name
       ) VALUES (?, ?, ?, 'someone@active.example.com', 'Someone')`,
    )
      .bind(
        "44444444-4444-4444-8444-444444444444",
        domain.id,
        administrator.userId,
      )
      .run();
    await expect(
      admin.deleteDomain(administrator, domain.id),
    ).rejects.toMatchObject({ code: "DOMAIN_IN_USE" });
  });

  it("returns and updates a signature", async () => {
    const admin = service();
    const domain = await admin.createDomain(administrator, "sig.example.com");
    const empty = await admin.getSignature(administrator, domain.id);
    expect(empty).toMatchObject({ domain_id: domain.id });
    await admin.putSignature(administrator, domain.id, {
      html: "<p>UniMailbox Team</p>",
      text: "UniMailbox Team",
      enabled: true,
    });
    const stored = await admin.getSignature(administrator, domain.id);
    expect(stored).toMatchObject({ is_enabled: 1 });
  });
});

describe("AdminApplicationService settings and analytics", () => {
  beforeEach(async () => {
    await seedAdministrator();
  });

  it("returns the current settings", async () => {
    const settings = await service().getSettings(administrator);
    expect(settings).toBeTruthy();
  });

  it("updates editable settings and rejects unknown keys", async () => {
    const admin = service();
    await expect(
      admin.updateSettings(administrator, {
        site_title: "UniMailbox",
        not_a_real_key: "no",
      }),
    ).rejects.toMatchObject({ code: "SETTINGS_INPUT_INVALID" });
    await admin.updateSettings(administrator, {
      site_title: "UniMailbox",
      registration_enabled: 1,
    });
  });

  it("returns aggregate analytics", async () => {
    const analytics = await service().analytics(administrator);
    expect(analytics).toBeTruthy();
  });

  it("lists webhook events and audit events", async () => {
    const admin = service();
    const events = await admin.listWebhookEvents(administrator, 50);
    const audit = await admin.listAuditEvents(administrator, {
      limit: 50,
      query: "test",
    });
    expect(Array.isArray(events)).toBe(true);
    expect(Array.isArray(audit)).toBe(true);
  });
});
