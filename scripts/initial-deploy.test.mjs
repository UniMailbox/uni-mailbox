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
fs.appendFileSync(process.env.FAKE_COMMAND_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "build") process.exit(0);
if (args.includes("deploy")) process.exit(process.env.FAKE_DEPLOY_FAILURE ? 9 : 0);
process.stderr.write("Unexpected command: " + args.join(" "));
process.exit(23);
`,
  );
  chmodSync(fakePnpm, 0o700);
}

function runInitialDeploy(environment = {}) {
  const directory = mkdtempSync(join(tmpdir(), "unimailbox-initial-deploy-"));
  const commandLog = join(directory, "commands.jsonl");
  createFakePnpm(directory);
  const result = spawnSync("node", ["scripts/initial-deploy.mjs"], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      FAKE_COMMAND_LOG: commandLog,
      ...environment,
    },
  });
  const commands = readFileSync(commandLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { directory, result, commands };
}

describe("minimal Cloudflare deployment", () => {
  it("requires no administrator credentials and only builds then deploys", () => {
    const scenario = runInitialDeploy({
      INITIAL_ADMIN_EMAIL: "",
      INITIAL_ADMIN_PASSWORD: "",
    });

    try {
      expect(
        scenario.result.status,
        scenario.result.stderr || scenario.result.stdout,
      ).toBe(0);
      expect(scenario.commands).toEqual([
        ["build"],
        [
          "exec",
          "wrangler",
          "--config",
          "wrangler.jsonc",
          "deploy",
          "--env",
          "",
        ],
      ]);
      expect(scenario.result.stdout).toContain(
        '"event":"deployment.initial.completed"',
      );
      expect(scenario.result.stdout).toContain('"credentialsRequired":false');
      expect(scenario.result.stdout).toContain("pnpm deployment:bootstrap");
      expect(scenario.commands.flat()).not.toContain("secret");
      expect(scenario.commands.flat()).not.toContain("migrations");
      expect(scenario.commands.flat()).not.toContain("verify");
    } finally {
      rmSync(scenario.directory, { recursive: true, force: true });
    }
  });

  it("stops when the provisioning deployment fails", () => {
    const scenario = runInitialDeploy({ FAKE_DEPLOY_FAILURE: "1" });

    try {
      expect(scenario.result.status).toBe(9);
      expect(scenario.commands).toHaveLength(2);
      expect(scenario.result.stdout).not.toContain(
        '"event":"deployment.initial.completed"',
      );
    } finally {
      rmSync(scenario.directory, { recursive: true, force: true });
    }
  });
});
