import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
const has = (value) => args.includes(value);
fs.appendFileSync(process.env.FAKE_COMMAND_LOG, JSON.stringify(args) + "\\n");

if (has("secret") && has("list")) {
  process.stdout.write(process.env.FAKE_EXISTING_SECRETS || "[]");
  process.exit(0);
}
if (has("migrations") && has("apply")) process.exit(0);
if (has("deploy") && has("--secrets-file")) {
  const secretPath = args[args.indexOf("--secrets-file") + 1];
  if (!secretPath || !fs.existsSync(secretPath)) process.exit(21);
  fs.writeFileSync(process.env.FAKE_SECRET_PATH_RECORD, secretPath);
  process.exit(0);
}
if (has("d1") && has("execute")) {
  const sql = has("--command") ? args[args.indexOf("--command") + 1] : "";
  const file = has("--file") ? args[args.indexOf("--file") + 1] : "";
  if (sql.includes("migration_table_present")) {
    process.stdout.write(JSON.stringify([{
      success: true,
      results: [{ migration_table_present: 0, application_schema_present: 0 }]
    }]));
    process.exit(0);
  }
  if (sql.includes("administrator_count")) {
    const count = fs.existsSync(process.env.FAKE_ADMIN_STATE) ? 1 : 0;
    process.stdout.write(JSON.stringify([{
      success: true,
      results: [{ administrator_count: count }]
    }]));
    process.exit(0);
  }
  if (sql.includes("current_step")) {
    process.stdout.write(JSON.stringify([{
      success: true,
      results: [{ current_step: "complete" }]
    }]));
    process.exit(0);
  }
  if (file.includes("administrator-bootstrap")) {
    fs.writeFileSync(process.env.FAKE_ADMIN_STATE, "created");
  }
  process.stdout.write(JSON.stringify([{ success: true, results: [] }]));
  process.exit(0);
}
process.stderr.write("Unexpected fake pnpm command: " + args.join(" "));
process.exit(23);
`,
  );
  chmodSync(fakePnpm, 0o700);
}

describe("post-provision Cloudflare bootstrap", () => {
  it("runs setup explicitly and never invokes release verification", () => {
    const directory = mkdtempSync(join(tmpdir(), "unimailbox-bootstrap-"));
    const commandLog = join(directory, "commands.jsonl");
    const administratorState = join(directory, "administrator-created");
    const secretPathRecord = join(directory, "secret-path");
    createFakePnpm(directory);

    try {
      const result = spawnSync("node", ["scripts/deployment-bootstrap.mjs"], {
        cwd: resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          FAKE_COMMAND_LOG: commandLog,
          FAKE_ADMIN_STATE: administratorState,
          FAKE_SECRET_PATH_RECORD: secretPathRecord,
          INITIAL_ADMIN_EMAIL: "admin@example.test",
          INITIAL_ADMIN_PASSWORD: "test-bootstrap-password",
        },
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      const commands = readFileSync(commandLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(commands[0]).toEqual([
        "exec",
        "wrangler",
        "--config",
        "wrangler.jsonc",
        "secret",
        "list",
        "--env",
        "",
        "--format",
        "json",
      ]);
      expect(commands.some((args) => args.includes("migrations"))).toBe(true);
      expect(commands.some((args) => args.includes("--secrets-file"))).toBe(
        true,
      );
      expect(commands.flat()).not.toContain("versions");
      expect(commands.flat()).not.toContain("time-travel");
      expect(commands.flat()).not.toContain("verify");
      expect(result.stdout).toContain(
        '"event":"deployment.bootstrap.completed"',
      );
      expect(result.stdout).not.toContain("test-bootstrap-password");

      const temporarySecretPath = readFileSync(secretPathRecord, "utf8");
      expect(() => readFileSync(temporarySecretPath)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("forwards an explicit administrator password reset flag", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "unimailbox-bootstrap-force-"),
    );
    const commandLog = join(directory, "commands.jsonl");
    const administratorState = join(directory, "administrator-created");
    const secretPathRecord = join(directory, "secret-path");
    createFakePnpm(directory);

    try {
      const result = spawnSync(
        "node",
        ["scripts/deployment-bootstrap.mjs", "--force-admin-password-reset"],
        {
          cwd: resolve(import.meta.dirname, ".."),
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            FAKE_COMMAND_LOG: commandLog,
            FAKE_ADMIN_STATE: administratorState,
            FAKE_SECRET_PATH_RECORD: secretPathRecord,
            INITIAL_ADMIN_EMAIL: "admin@example.test",
            INITIAL_ADMIN_PASSWORD: "test-bootstrap-password",
          },
        },
      );

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain(
        '"args":["scripts/bootstrap-admin.mjs","--target","production","--force-admin-password-reset"]',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
