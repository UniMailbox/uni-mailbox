import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const root = resolve(import.meta.dirname, "..");
export const migrationsDirectory = resolve(root, "migrations");
export const migrationPattern = /^(\d{4})_([a-z0-9_]+)\.sql$/u;
mkdirSync(resolve(root, ".wrangler", "logs"), { recursive: true });
process.env.WRANGLER_LOG_PATH ??= resolve(
  root,
  ".wrangler",
  "logs",
  "wrangler.log",
);

export function output(event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...fields,
    })}\n`,
  );
}

export function fail(event, message, exitCode = 1, fields = {}) {
  output(event, { status: "failed", message, ...fields });
  process.exit(exitCode);
}

export function run(command, args, options = {}) {
  output("command.started", { command, args });
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    ...options,
  });
  if (result.error) {
    fail("command.failed", result.error.message, 2, { command, args });
  }
  if (result.status !== 0) {
    fail(
      "command.failed",
      `${command} exited with ${result.status}`,
      result.status ?? 2,
      {
        command,
        args,
      },
    );
  }
  output("command.completed", { command, args });
}

export function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

export function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

export function readJsonc(path) {
  const source = readFileSync(resolve(root, path), "utf8");
  let withoutComments = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        withoutComments += character;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      } else if (character === "\n") {
        withoutComments += character;
      }
      continue;
    }
    if (!inString && character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (!inString && character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    withoutComments += character;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    }
  }

  let normalized = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    if (!inString && character === ",") {
      let cursor = index + 1;
      while (/\s/u.test(withoutComments[cursor] ?? "")) cursor += 1;
      if (["}", "]"].includes(withoutComments[cursor])) continue;
    }
    normalized += character;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    }
  }
  return JSON.parse(normalized);
}

export function migrationFiles() {
  return readdirSync(migrationsDirectory)
    .filter((name) => migrationPattern.test(name))
    .sort();
}

export function sha256File(path) {
  return createHash("sha256")
    .update(readFileSync(resolve(root, path)))
    .digest("hex");
}

export function assertMigrationSet() {
  const files = migrationFiles();
  if (files.length === 0) fail("migration.invalid", "No migrations found", 3);
  files.forEach((file, index) => {
    const match = migrationPattern.exec(file);
    const expected = String(index + 1).padStart(4, "0");
    if (!match || match[1] !== expected) {
      fail(
        "migration.invalid",
        `Expected migration ${expected}, found ${file}`,
        3,
      );
    }
    const basename = file.replace(/\.sql$/u, "");
    for (const suffix of [".verify.sql", ".md"]) {
      const metadata = resolve(
        migrationsDirectory,
        "meta",
        `${basename}${suffix}`,
      );
      if (!existsSync(metadata)) {
        fail(
          "migration.invalid",
          `Missing paired migration artifact: ${metadata}`,
          3,
        );
      }
    }
  });
  const checksumsPath = resolve(
    migrationsDirectory,
    "meta",
    "released-checksums.json",
  );
  if (existsSync(checksumsPath)) {
    const released = JSON.parse(readFileSync(checksumsPath, "utf8"));
    for (const [file, expected] of Object.entries(released)) {
      const actual = sha256File(`migrations/${file}`);
      if (actual !== expected) {
        fail(
          "migration.checksum_mismatch",
          `Released migration ${file} was modified`,
          4,
          { expected, actual },
        );
      }
    }
  }
  return files;
}

export function parseTarget(args) {
  const index = args.indexOf("--target");
  const target = index >= 0 ? args[index + 1] : "local";
  if (!["local", "preview", "production"].includes(target)) {
    fail("target.invalid", `Unknown target: ${target}`, 2);
  }
  return target;
}

export function wranglerTargetArgs(target) {
  if (target === "local") return ["--local"];
  if (target === "preview") return ["--remote", "--env", "preview"];
  return ["--remote"];
}
