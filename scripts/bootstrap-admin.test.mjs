import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function createFakePnpm(directory) {
  const fakePnpm = join(directory, "pnpm");
  writeFileSync(
    fakePnpm,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const sql = args.includes("--command") ? args[args.indexOf("--command") + 1] : "";
const file = args.includes("--file") ? args[args.indexOf("--file") + 1] : "";
fs.appendFileSync(process.env.FAKE_COMMAND_LOG, JSON.stringify(args) + "\\n");

if (sql.includes("administrator_count")) {
  process.stdout.write(JSON.stringify([{ success: true, results: [{ administrator_count: 1 }] }]));
  process.exit(0);
}
if (sql.includes("password_iterations") && sql.includes("administrator_role")) {
  const repaired = fs.existsSync(process.env.FAKE_REPAIRED_STATE);
  const initialIterations = Number(process.env.FAKE_INITIAL_ITERATIONS || "310000");
  const repairedHash = repaired
    ? fs.readFileSync(process.env.FAKE_REPAIRED_STATE, "utf8")
    : "existing-password-hash";
  process.stdout.write(JSON.stringify([{ success: true, results: [{
    email: "admin@example.com",
    password_hash: repairedHash,
    password_algorithm: "pbkdf2-sha256",
    password_iterations: repaired ? 100000 : initialIterations
  }] }]));
  process.exit(0);
}
if (file.includes("administrator-password-repair")) {
  const contents = fs.readFileSync(file, "utf8");
  if (contents.includes(process.env.INITIAL_ADMIN_PASSWORD)) process.exit(31);
  if (!contents.includes("UPDATE sessions")) process.exit(32);
  const hash = /password_hash = '([^']+)'/.exec(contents)?.[1];
  if (!hash) process.exit(33);
  fs.writeFileSync(process.env.FAKE_REPAIRED_STATE, hash);
  process.stdout.write(JSON.stringify([{ success: true, results: [] }]));
  process.exit(0);
}
if (sql.includes("UPDATE installation_state")) {
  process.stdout.write(JSON.stringify([{ success: true, results: [] }]));
  process.exit(0);
}
process.stderr.write("Unexpected fake pnpm command: " + args.join(" "));
process.exit(23);
`,
  );
  chmodSync(fakePnpm, 0o700);
}

describe("administrator bootstrap repair", () => {
  it("replaces an unsupported password hash without exposing the password", () => {
    const directory = mkdtempSync(join(tmpdir(), "unimailbox-admin-repair-"));
    const commandLog = join(directory, "commands.jsonl");
    const repairedState = join(directory, "administrator-repaired");
    createFakePnpm(directory);

    try {
      const result = spawnSync("node", ["scripts/bootstrap-admin.mjs"], {
        cwd: resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          FAKE_COMMAND_LOG: commandLog,
          FAKE_REPAIRED_STATE: repairedState,
          INITIAL_ADMIN_EMAIL: "admin@example.com",
          INITIAL_ADMIN_PASSWORD: "test-bootstrap-password",
        },
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain(
        '"event":"bootstrap.administrator.password_repaired"',
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(
        "test-bootstrap-password",
      );
      expect(readFileSync(repairedState, "utf8")).toMatch(
        /^[A-Za-z0-9_-]{43}$/u,
      );
      expect(readFileSync(commandLog, "utf8")).not.toContain(
        "test-bootstrap-password",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not replace a supported password without the force flag", () => {
    const directory = mkdtempSync(join(tmpdir(), "unimailbox-admin-existing-"));
    const commandLog = join(directory, "commands.jsonl");
    const repairedState = join(directory, "administrator-repaired");
    createFakePnpm(directory);

    try {
      const result = spawnSync("node", ["scripts/bootstrap-admin.mjs"], {
        cwd: resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          FAKE_COMMAND_LOG: commandLog,
          FAKE_REPAIRED_STATE: repairedState,
          FAKE_INITIAL_ITERATIONS: "100000",
          INITIAL_ADMIN_EMAIL: "admin@example.com",
          INITIAL_ADMIN_PASSWORD: "must-not-be-used-password",
        },
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain(
        '"event":"bootstrap.administrator.existing"',
      );
      expect(existsSync(repairedState)).toBe(false);
      expect(readFileSync(commandLog, "utf8")).not.toContain(
        "must-not-be-used-password",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("force-resets a supported administrator password and revokes sessions", () => {
    const directory = mkdtempSync(join(tmpdir(), "unimailbox-admin-force-"));
    const commandLog = join(directory, "commands.jsonl");
    const repairedState = join(directory, "administrator-repaired");
    createFakePnpm(directory);

    try {
      const result = spawnSync(
        "node",
        ["scripts/bootstrap-admin.mjs", "--force-admin-password-reset"],
        {
          cwd: resolve(import.meta.dirname, ".."),
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            FAKE_COMMAND_LOG: commandLog,
            FAKE_REPAIRED_STATE: repairedState,
            FAKE_INITIAL_ITERATIONS: "100000",
            INITIAL_ADMIN_EMAIL: "admin@example.com",
            INITIAL_ADMIN_PASSWORD: "new-test-bootstrap-password",
          },
        },
      );

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain(
        '"event":"bootstrap.administrator.password_reset"',
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(
        "new-test-bootstrap-password",
      );
      expect(readFileSync(repairedState, "utf8")).toMatch(
        /^[A-Za-z0-9_-]{43}$/u,
      );
      expect(readFileSync(commandLog, "utf8")).not.toContain(
        "new-test-bootstrap-password",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires explicit credentials for a forced password reset", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "unimailbox-admin-force-credentials-"),
    );
    const commandLog = join(directory, "commands.jsonl");
    const repairedState = join(directory, "administrator-repaired");
    createFakePnpm(directory);

    try {
      const result = spawnSync(
        "node",
        ["scripts/bootstrap-admin.mjs", "--force-admin-password-reset"],
        {
          cwd: resolve(import.meta.dirname, ".."),
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            FAKE_COMMAND_LOG: commandLog,
            FAKE_REPAIRED_STATE: repairedState,
            FAKE_INITIAL_ITERATIONS: "100000",
            INITIAL_ADMIN_EMAIL: "admin@example.com",
            INITIAL_ADMIN_PASSWORD: "",
          },
        },
      );

      expect(result.status).toBe(8);
      expect(result.stdout).toContain(
        '"event":"bootstrap.administrator.password_reset_credentials_required"',
      );
      expect(existsSync(repairedState)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
