#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  capture,
  fail,
  output,
  parseTarget,
  root,
  wranglerTargetArgs,
} from "./_shared.mjs";
import {
  createAdministratorBootstrapSql,
  createPasswordRecord,
  validateInitialAdministrator,
} from "./bootstrap-lib.mjs";

const target = parseTarget(process.argv.slice(2));
const releaseDirectory = resolve(root, ".wrangler", "release");
const administratorRoleId = "00000000-0000-4000-8000-000000000001";
const administratorCountSql = `SELECT COUNT(*) AS administrator_count
FROM users user
JOIN user_roles role ON role.user_id = user.id
WHERE role.role_id = '${administratorRoleId}'`;
const installationStateSql =
  "SELECT current_step FROM installation_state WHERE id = 1";

function executeD1({ command, file }) {
  const args = [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "DB",
    ...wranglerTargetArgs(target),
    ...(command ? ["--command", command] : ["--file", file]),
    "--json",
  ];
  const result = capture("pnpm", args);
  if (!result.ok) {
    fail(
      "bootstrap.d1_command_failed",
      "D1 administrator bootstrap command failed",
      5,
      { stderrBytes: Buffer.byteLength(result.stderr) },
    );
  }
  try {
    const statements = JSON.parse(result.stdout);
    if (
      !Array.isArray(statements) ||
      statements.some((item) => !item?.success)
    ) {
      throw new Error("D1 returned unsuccessful statements");
    }
    return statements;
  } catch {
    fail(
      "bootstrap.d1_output_invalid",
      "D1 administrator bootstrap returned invalid JSON",
      5,
    );
  }
}

function firstNumber(statements, field) {
  const value = statements[0]?.results?.[0]?.[field];
  if (typeof value !== "number") {
    fail(
      "bootstrap.d1_output_invalid",
      `D1 administrator bootstrap did not return ${field}`,
      5,
    );
  }
  return value;
}

function administratorCount() {
  return firstNumber(
    executeD1({ command: administratorCountSql }),
    "administrator_count",
  );
}

function administratorEmail() {
  // Used purely for the "already exists" warning so the operator knows which
  // row to clear or which account to sign in with.
  const results = executeD1({
    command: "SELECT email FROM users ORDER BY created_at ASC LIMIT 1",
  })[0]?.results;
  return Array.isArray(results) && results.length > 0
    ? String(results[0].email ?? "")
    : null;
}

function ensureCompleteState() {
  executeD1({
    command: `UPDATE installation_state
SET status = 'complete',
    current_step = 'complete',
    completed_steps_json = '["admin_bootstrap"]',
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1`,
  });
}

if (administratorCount() > 0) {
  ensureCompleteState();
  // When the operator runs `pnpm bootstrap:admin` a second time, we never
  // know whether they meant "everything is fine" or "I forgot the password,
  // please reset it". Silently exiting as `ok` was the wrong default — it
  // swallowed the second case and the next login returned 401. Warn
  // explicitly so the operator picks the right follow-up.
  const email = administratorEmail();
  process.stderr.write(
    `\n⚠️  An administrator already exists (${email ?? "unknown email"}).\n` +
      `    bootstrap:admin will NOT update the password.\n` +
      `    If you need to reset it, run one of:\n` +
      `      • wrangler d1 execute DB --local --command "UPDATE users SET password_hash = NULL, password_salt = NULL, password_iterations = NULL WHERE email = '${email ?? ""}'" then re-run bootstrap:admin\n` +
      `      • sign in and use POST /api/v1/auth/password/reset\n\n`,
  );
  output("bootstrap.administrator.existing", {
    status: "ok",
    target,
    email,
  });
} else {
  let credentials;
  try {
    credentials = validateInitialAdministrator(process.env);
  } catch (error) {
    fail(
      "bootstrap.initial_credentials_invalid",
      error instanceof Error
        ? error.message
        : "Initial credentials are invalid",
      6,
    );
  }
  const passwordRecord = await createPasswordRecord(credentials.password);
  const sql = createAdministratorBootstrapSql({
    userId: randomUUID(),
    email: credentials.email,
    displayName: "Administrator",
    passwordRecord,
  });
  mkdirSync(releaseDirectory, { recursive: true });
  const path = resolve(
    releaseDirectory,
    `.administrator-bootstrap-${randomUUID()}.sql`,
  );
  writeFileSync(path, sql, { mode: 0o600, flag: "wx" });
  try {
    executeD1({ file: path });
  } finally {
    if (existsSync(path)) unlinkSync(path);
  }

  const count = administratorCount();
  const state = executeD1({ command: installationStateSql })[0]?.results?.[0]
    ?.current_step;
  if (count !== 1 || state !== "complete") {
    fail(
      "bootstrap.postcondition_failed",
      "Administrator bootstrap did not reach its required postcondition",
      7,
    );
  }
  output("bootstrap.administrator.completed", {
    status: "ok",
    target,
  });
}
