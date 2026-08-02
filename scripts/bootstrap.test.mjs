import { access, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PasswordService } from "../apps/worker/src/modules/identity";
import {
  WORKERS_PBKDF2_MAX_ITERATIONS,
  createAdministratorBootstrapSql,
  createAdministratorPasswordRepairSql,
  createPasswordRecord,
  reconcileRuntimeSecretNames,
  sqlLiteral,
  validateInitialAdministrator,
} from "./bootstrap-lib.mjs";
import { withSecureTemporaryJson } from "./_shared.mjs";

describe("zero-touch bootstrap helpers", () => {
  it("generates only confirmed-missing runtime secrets", () => {
    const generated = reconcileRuntimeSecretNames(
      ["AUTH_SIGNING_KEY"],
      (length) => Uint8Array.from({ length }, (_, index) => index % 256),
    );

    expect(Object.keys(generated)).toEqual(["CREDENTIAL_ENCRYPTION_KEY"]);
    expect(generated.CREDENTIAL_ENCRYPTION_KEY).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("rejects an unknown remote secret state instead of rotating keys", () => {
    expect(() =>
      reconcileRuntimeSecretNames(undefined, () => new Uint8Array(32)),
    ).toThrow(/remote runtime secret state is unavailable/iu);
  });

  it("normalizes valid initial administrator credentials", () => {
    expect(
      validateInitialAdministrator({
        INITIAL_ADMIN_EMAIL: "  ADMIN@Example.COM ",
        INITIAL_ADMIN_PASSWORD: "a-strong-password",
      }),
    ).toEqual({
      email: "admin@example.com",
      password: "a-strong-password",
    });
  });

  it("rejects an invalid initial administrator password without echoing it", () => {
    expect(() =>
      validateInitialAdministrator({
        INITIAL_ADMIN_EMAIL: "admin@example.com",
        INITIAL_ADMIN_PASSWORD: "short",
      }),
    ).toThrow("INITIAL_ADMIN_PASSWORD must contain 12 to 1024 characters");
  });

  it("creates a password record compatible with the runtime policy", async () => {
    const record = await createPasswordRecord("a-strong-password", {
      randomBytes: (length) => new Uint8Array(length).fill(7),
      iterations: 2,
    });

    expect(record).toEqual({
      algorithm: "pbkdf2-sha256",
      hash: "lQyRv7KLXVwYK9rforTrVC6Wij31XEFyLZRtr_NcL38",
      iterations: 2,
      salt: "BwcHBwcHBwcHBwcHBwcHBw",
    });
    await expect(
      new PasswordService({ iterations: 2 }).verify(
        "a-strong-password",
        record,
      ),
    ).resolves.toEqual({ valid: true, needsRehash: false });
  });

  it("keeps generated password records within the Workers PBKDF2 ceiling", async () => {
    const record = await createPasswordRecord("a-strong-password", {
      randomBytes: (length) => new Uint8Array(length).fill(7),
    });

    expect(WORKERS_PBKDF2_MAX_ITERATIONS).toBe(100_000);
    expect(record.iterations).toBe(WORKERS_PBKDF2_MAX_ITERATIONS);
    await expect(
      new PasswordService({
        iterations: WORKERS_PBKDF2_MAX_ITERATIONS,
      }).verify("a-strong-password", record),
    ).resolves.toEqual({ valid: true, needsRehash: false });
  });

  it("encodes SQL literals without exposing an injection boundary", () => {
    expect(sqlLiteral("admin.o'hare@example.com")).toBe(
      "'admin.o''hare@example.com'",
    );
  });

  it("builds an idempotent administrator bootstrap batch without plaintext credentials", () => {
    const sql = createAdministratorBootstrapSql({
      userId: "11111111-1111-4111-8111-111111111111",
      email: "admin@example.com",
      displayName: "Administrator",
      passwordRecord: {
        algorithm: "pbkdf2-sha256",
        hash: "derived-password-hash",
        iterations: 310_000,
        salt: "random-password-salt",
      },
    });

    expect(sql).toContain("INSERT INTO users");
    expect(sql).toContain("INSERT INTO user_roles");
    expect(sql).toContain("current_step = 'complete'");
    expect(sql).toContain("WHERE NOT EXISTS");
    expect(sql).toContain("derived-password-hash");
    expect(sql).not.toContain("a-strong-password");
  });

  it("repairs only an administrator password record above the Workers ceiling", () => {
    const sql = createAdministratorPasswordRepairSql({
      email: "admin@example.com",
      passwordRecord: {
        algorithm: "pbkdf2-sha256",
        hash: "replacement-password-hash",
        iterations: 100_000,
        salt: "replacement-password-salt",
      },
    });

    expect(sql).toContain("replacement-password-hash");
    expect(sql).toContain("password_iterations > 100000");
    expect(sql).toContain("administrator_role.role_id");
    expect(sql).toContain("UPDATE sessions");
    expect(sql).toContain("admin@example.com");
    expect(sql).not.toContain("a-strong-password");
  });

  it("builds an explicit forced administrator password reset", () => {
    const sql = createAdministratorPasswordRepairSql({
      email: "admin@example.com",
      force: true,
      passwordRecord: {
        algorithm: "pbkdf2-sha256",
        hash: "forced-password-hash",
        iterations: 100_000,
        salt: "forced-password-salt",
      },
    });

    expect(sql).toContain("forced-password-hash");
    expect(sql).toContain("UPDATE sessions");
    expect(sql).not.toContain("password_iterations > 100000");
  });
});

describe("secure temporary JSON", () => {
  it("uses owner-only permissions and removes the file after success", async () => {
    let path = "";
    await withSecureTemporaryJson(
      tmpdir(),
      { AUTH_SIGNING_KEY: "secret" },
      async (temporaryPath) => {
        path = temporaryPath;
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
          AUTH_SIGNING_KEY: "secret",
        });
      },
    );

    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes the file when the callback fails", async () => {
    let path = join(tmpdir(), "not-created");
    await expect(
      withSecureTemporaryJson(
        tmpdir(),
        { secret: "value" },
        (temporaryPath) => {
          path = temporaryPath;
          throw new Error("callback failed");
        },
      ),
    ).rejects.toThrow("callback failed");

    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
