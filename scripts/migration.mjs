#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertMigrationSet,
  capture,
  fail,
  migrationFiles,
  migrationsDirectory,
  output,
  parseTarget,
  root,
  run,
  withSecureTemporaryText,
  wranglerTargetArgs,
} from "./_shared.mjs";

const args = process.argv.slice(2);
const command = args[0];
const target = parseTarget(args);

function assertVerifySqlSafe(sql, verifyPath) {
  // Split on newlines; the very first non-empty line must not start
  // with "--" — wrangler's CLI sees that as the end-of-options marker
  // when we used --command, and even with --file it's a footgun.
  const firstNonEmptyLine =
    sql.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? "";
  if (firstNonEmptyLine.trimStart().startsWith("--")) {
    fail(
      "migration.verify_comment_prefix",
      `${verifyPath} starts with a SQL line comment; rewrite it so the first non-empty line begins with a statement (e.g. SELECT). See docs/rules/migrations.md.`,
      9,
      { verifyPath },
    );
  }
}

function createMigration() {
  const rawName = args[1] ?? "";
  const name = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (!name) fail("migration.name_invalid", "A migration name is required", 2);
  const files = migrationFiles();
  const number = String(files.length + 1).padStart(4, "0");
  const basename = `${number}_${name}`;
  const paths = {
    sql: resolve(migrationsDirectory, `${basename}.sql`),
    verify: resolve(migrationsDirectory, "meta", `${basename}.verify.sql`),
    metadata: resolve(migrationsDirectory, "meta", `${basename}.md`),
  };
  writeFileSync(
    paths.sql,
    "-- Expand-and-contract migration. Add reviewed SQL below.\nPRAGMA foreign_keys = ON;\n",
  );
  const verificationSql =
    "-- TODO: replace with a SELECT CASE that asserts the schema/data state\n" +
    "-- this migration introduces. It must return exactly one row whose only\n" +
    "-- column equals 1 when valid. PRAGMA foreign_key_check; below stays.\n" +
    "SELECT CASE\n" +
    "  WHEN (\n" +
    "    -- TODO: assert the new state. Example:\n" +
    "    --   (SELECT COUNT(*) FROM pragma_table_info('<table>') WHERE name = '<column>') = 1\n" +
    "    SELECT 0\n" +
    "  ) = 1\n" +
    "  THEN 1\n" +
    "  ELSE 0\n" +
    "END AS migration_verified;\n" +
    "PRAGMA foreign_key_check;\n";
  writeFileSync(paths.verify, verificationSql);
  assertVerifySqlSafe(verificationSql, paths.verify);
  writeFileSync(
    paths.metadata,
    `# ${basename.replaceAll("_", " ")}\n\n- Purpose: TODO\n- Compatibility window: TODO\n- Expected duration: TODO\n- Backfill: none\n- Verification: \`migrations/meta/${basename}.verify.sql\`\n- Recovery: fix forward with a new migration; never edit this file after release.\n`,
  );
  output("migration.created", { status: "ok", ...paths });
}

function ensureProductionConfirmation() {
  if (target !== "production") return;
  const confirmIndex = args.indexOf("--confirm");
  const confirmation = confirmIndex >= 0 ? args[confirmIndex + 1] : "";
  if (!confirmation || confirmation.length < 7) {
    fail(
      "migration.production_confirmation_required",
      "Production migrations require --confirm <deployment-id>",
      7,
    );
  }
  output("migration.production_confirmed", { confirmation });
}

function parseD1Row(raw, fields, event) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(event, "D1 did not return valid JSON", 5);
  }
  const row = parsed?.[0]?.results?.[0];
  if (
    parsed?.[0]?.success !== true ||
    !row ||
    fields.some((field) => !Number.isSafeInteger(row[field]))
  ) {
    fail(event, "D1 did not return the expected schema state", 5);
  }
  return row;
}

function queryD1Row(sql, fields) {
  const command = [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "DB",
    ...wranglerTargetArgs(target),
    "--command",
    sql,
    "--json",
  ];
  output("command.started", { command: "pnpm", args: command });
  const result = capture("pnpm", command);
  if (!result.ok) {
    fail(
      "migration.initial_schema_state_failed",
      "Could not inspect the initial D1 schema state",
      5,
      { stderrBytes: Buffer.byteLength(result.stderr) },
    );
  }
  const row = parseD1Row(
    result.stdout,
    fields,
    "migration.initial_schema_state_invalid",
  );
  output("command.completed", { command: "pnpm", args: command });
  return row;
}

async function bootstrapRemoteInitialMigration() {
  if (target === "local") return;
  const schema = queryD1Row(
    `SELECT
      EXISTS(
        SELECT 1 FROM sqlite_schema
        WHERE type = 'table' AND name = 'd1_migrations'
      ) AS migration_table_present,
      EXISTS(
        SELECT 1 FROM sqlite_schema
        WHERE type = 'table'
          AND name IN ('users', 'installation_state')
      ) AS application_schema_present`,
    ["migration_table_present", "application_schema_present"],
  );
  let initialMigrationCount = 0;
  if (schema.migration_table_present === 1) {
    ({ initial_migration_count: initialMigrationCount } = queryD1Row(
      `SELECT COUNT(*) AS initial_migration_count
       FROM d1_migrations
       WHERE name = '0001_initial.sql'`,
      ["initial_migration_count"],
    ));
  }
  if (initialMigrationCount > 0) return;
  if (schema.application_schema_present > 0) {
    fail(
      "migration.initial_schema_untracked",
      "The application schema exists without a recorded initial migration",
      8,
    );
  }

  const initialMigration = readFileSync(
    resolve(migrationsDirectory, "0001_initial.sql"),
    "utf8",
  );
  const bootstrapSql = `CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

${initialMigration}

INSERT INTO d1_migrations (name)
VALUES ('0001_initial.sql');
`;
  await withSecureTemporaryText(
    resolve(root, ".wrangler", "release"),
    ".sql",
    bootstrapSql,
    (path) =>
      run("pnpm", [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "DB",
        ...wranglerTargetArgs(target),
        "--file",
        path,
      ]),
  );
  output("migration.initial_schema_imported", {
    status: "ok",
    target,
    migration: "0001_initial.sql",
  });
}

async function migrate() {
  const files = assertMigrationSet();
  ensureProductionConfirmation();
  await bootstrapRemoteInitialMigration();
  run("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    ...wranglerTargetArgs(target),
  ]);
  output("migration.apply.completed", { status: "ok", target, files });
}

function status() {
  assertMigrationSet();
  run("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "list",
    "DB",
    ...wranglerTargetArgs(target),
  ]);
}

async function verify() {
  const files = assertMigrationSet();
  for (const file of files) {
    const basename = file.replace(/\.sql$/u, "");
    const verifyPath = `migrations/meta/${basename}.verify.sql`;
    const verificationSql = readFileSync(
      resolve(process.cwd(), verifyPath),
      "utf8",
    );
    if (!verificationSql.includes("SELECT")) {
      fail(
        "migration.verify_invalid",
        `${verifyPath} has no verification query`,
        3,
      );
    }
    assertVerifySqlSafe(verificationSql, verifyPath);
    const result = await withSecureTemporaryText(
      resolve(root, ".wrangler", "release"),
      ".sql",
      verificationSql,
      async (path) => {
        const command = [
          "exec",
          "wrangler",
          "d1",
          "execute",
          "DB",
          ...wranglerTargetArgs(target),
          // --file ships the SQL through D1's execute API (not the bulk import
          // API), so SELECT results come back in JSON. -c is not used because
          // argv parsing of any leading `--` SQL comment confuses wrangler's
          // CLI into treating the rest as positional arguments.
          "--file",
          path,
          "--json",
        ];
        const loggedCommand = command.map((value) =>
          value === path ? `<contents of ${verifyPath}>` : value,
        );
        output("command.started", { command: "pnpm", args: loggedCommand });
        const captureResult = capture("pnpm", command);
        output("command.completed", { command: "pnpm", args: loggedCommand });
        return captureResult;
      },
    );
    if (!result.ok) {
      fail("migration.verify_command_failed", result.stderr, 5, {
        verifyPath,
      });
    }

    let statements;
    try {
      statements = JSON.parse(result.stdout);
    } catch {
      fail(
        "migration.verify_output_invalid",
        `${verifyPath} did not return valid JSON`,
        5,
        {
          stdoutBytes: Buffer.byteLength(result.stdout),
          stderrBytes: Buffer.byteLength(result.stderr),
        },
      );
    }

    if (!Array.isArray(statements)) {
      fail(
        "migration.verify_output_invalid",
        `${verifyPath} did not return a statement result array`,
        5,
      );
    }

    const assertion = statements[0];
    const row = assertion?.results?.[0];
    const assertionPassed =
      assertion?.success === true &&
      row &&
      Object.values(row).length > 0 &&
      Object.values(row).every((value) => value === 1);
    const remainingChecksPassed = statements
      .slice(1)
      .every(
        (statement) =>
          statement?.success === true && statement.results?.length === 0,
      );
    if (!assertionPassed || !remainingChecksPassed) {
      fail(
        "migration.verify_assertion_failed",
        `${verifyPath} reported an invalid schema or data state`,
        6,
        { statements },
      );
    }
  }
  output("migration.verify.completed", { status: "ok", target, files });
}

if (command === "new") createMigration();
else if (command === "migrate") await migrate();
else if (command === "status") status();
else if (command === "verify") await verify();
else {
  fail(
    "migration.usage",
    "Usage: migration.mjs new <name>|status|migrate|verify [--target local|preview|production]",
    2,
  );
}
