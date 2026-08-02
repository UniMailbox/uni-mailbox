import { describe, expect, it } from "vitest";
import { parseJsonc } from "./_shared.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertDeploymentCredentials,
  buildUpgradePrBody,
  parseGitHubRepository,
  parseJsonOutput,
  parseConflictPaths,
  selectStableUpgrade,
  validateCloudflareResolution,
  validateProductionEnvironment,
} from "./deployment-cli-lib.mjs";

const protectedEnvironment = {
  name: "production",
  can_admins_bypass: false,
  protection_rules: [
    {
      type: "required_reviewers",
      reviewers: [{ reviewer: { login: "release-owner" }, type: "User" }],
      prevent_self_review: true,
    },
  ],
  deployment_branch_policy: {
    protected_branches: false,
    custom_branch_policies: true,
  },
};

describe("production environment gate", () => {
  it("accepts an exact main policy, reviewer, self-review prevention, variable and secrets", () => {
    expect(() =>
      validateProductionEnvironment({
        environment: protectedEnvironment,
        branchPolicies: [{ name: "main" }],
        variables: [
          { name: "DEPLOYMENT_URL", value: "https://mail.example.com" },
        ],
        secrets: [
          { name: "CLOUDFLARE_API_TOKEN" },
          { name: "CLOUDFLARE_ACCOUNT_ID" },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    ["reviewer", { protection_rules: [] }],
    [
      "prevent self review",
      {
        protection_rules: [
          {
            type: "required_reviewers",
            reviewers: [{ reviewer: { login: "owner" } }],
            prevent_self_review: false,
          },
        ],
      },
    ],
    ["administrator bypass", { can_admins_bypass: true }],
    [
      "custom branch policy",
      {
        deployment_branch_policy: {
          protected_branches: true,
          custom_branch_policies: false,
        },
      },
    ],
  ])("fails closed when %s protection is missing", (_label, override) => {
    expect(() =>
      validateProductionEnvironment({
        environment: { ...protectedEnvironment, ...override },
        branchPolicies: [{ name: "main" }],
        variables: [
          { name: "DEPLOYMENT_URL", value: "https://mail.example.com" },
        ],
        secrets: [
          { name: "CLOUDFLARE_API_TOKEN" },
          { name: "CLOUDFLARE_ACCOUNT_ID" },
        ],
      }),
    ).toThrow();
  });

  it("requires only main, an HTTPS deployment URL, and both environment secrets", () => {
    expect(() =>
      validateProductionEnvironment({
        environment: protectedEnvironment,
        branchPolicies: [{ name: "main" }, { name: "release/*" }],
        variables: [{ name: "DEPLOYMENT_URL", value: "http://localhost" }],
        secrets: [{ name: "CLOUDFLARE_API_TOKEN" }],
      }),
    ).toThrow(/only main|DEPLOYMENT_URL|CLOUDFLARE_ACCOUNT_ID/iu);
  });

  it("rejects a missing environment, variable, or API token", () => {
    const common = {
      branchPolicies: [{ name: "main" }],
      variables: [
        { name: "DEPLOYMENT_URL", value: "https://mail.example.com" },
      ],
      secrets: [
        { name: "CLOUDFLARE_API_TOKEN" },
        { name: "CLOUDFLARE_ACCOUNT_ID" },
      ],
    };
    expect(() =>
      validateProductionEnvironment({ ...common, environment: undefined }),
    ).toThrow(/production/iu);
    expect(() =>
      validateProductionEnvironment({
        ...common,
        environment: protectedEnvironment,
        variables: [],
      }),
    ).toThrow(/DEPLOYMENT_URL/iu);
    expect(() =>
      validateProductionEnvironment({
        ...common,
        environment: protectedEnvironment,
        secrets: [{ name: "CLOUDFLARE_ACCOUNT_ID" }],
      }),
    ).toThrow(/CLOUDFLARE_API_TOKEN/u);
  });

  it("requires explicit attestation when GitHub omits the admin bypass setting", () => {
    const environment = { ...protectedEnvironment };
    delete environment.can_admins_bypass;
    const input = {
      environment,
      branchPolicies: [{ name: "main" }],
      variables: [
        { name: "DEPLOYMENT_URL", value: "https://mail.example.com" },
      ],
      secrets: [
        { name: "CLOUDFLARE_API_TOKEN" },
        { name: "CLOUDFLARE_ACCOUNT_ID" },
      ],
    };
    expect(() => validateProductionEnvironment(input)).toThrow(
      /confirm-admin-bypass-disabled/iu,
    );
    expect(
      validateProductionEnvironment({
        ...input,
        adminBypassConfirmed: true,
      }).adminBypassVerification,
    ).toBe("operator_attestation");
  });
});

describe("CLI fail-closed boundaries", () => {
  const runCli = (script, environment = {}) =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL(script, import.meta.url))],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        env: { PATH: process.env.PATH, ...environment },
      },
    );

  it("rejects production preflight before external calls when context is absent", () => {
    const result = runCli("./production-preflight.mjs");
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("deployment.production_preflight.failed");
    expect(result.stdout).not.toMatch(/token|password|secret value/iu);
  });

  it("rejects adoption in an official repository", () => {
    const result = runCli("./deployment-adopt.mjs", {
      GITHUB_REPOSITORY: "UniMailbox/unimailbox-deploy",
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("deployment.adoption.failed");
  });

  it("skips updater execution in official repositories", () => {
    const result = runCli("./upstream-sync.mjs", {
      GITHUB_REPOSITORY: "UniMailbox/uni-mailbox",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"reason":"official_repository"');
  });
});

describe("production credential gate", () => {
  it("accepts credentials without returning or logging their values", () => {
    expect(
      assertDeploymentCredentials({
        CLOUDFLARE_API_TOKEN: "do-not-log",
        CLOUDFLARE_ACCOUNT_ID: "account-id",
      }),
    ).toEqual({ configured: true });
  });

  it("fails closed when either credential is absent", () => {
    expect(() =>
      assertDeploymentCredentials({ CLOUDFLARE_API_TOKEN: "token" }),
    ).toThrow(/CLOUDFLARE_ACCOUNT_ID/u);
    expect(() =>
      assertDeploymentCredentials({ CLOUDFLARE_ACCOUNT_ID: "account" }),
    ).toThrow(/CLOUDFLARE_API_TOKEN/u);
  });

  it("requires Wrangler to resolve both the Worker and the adopted D1", () => {
    const manifest = {
      worker: { name: "customer-mail" },
      resources: {
        d1: { name: "customer-mail-db", id: "database-id" },
      },
    };
    expect(() =>
      validateCloudflareResolution({
        versions: [{ id: "worker-version" }],
        d1: { uuid: "database-id", name: "customer-mail-db" },
        manifest,
      }),
    ).not.toThrow();
    expect(() =>
      validateCloudflareResolution({ versions: [], d1: {}, manifest }),
    ).toThrow(/Worker/iu);
    expect(() =>
      validateCloudflareResolution({
        versions: [{ id: "worker-version" }],
        d1: { uuid: "different", name: "customer-mail-db" },
        manifest,
      }),
    ).toThrow(/D1/iu);
    expect(() =>
      validateCloudflareResolution({
        versions: [{ id: "worker-version" }],
        d1: { uuid: "database-id", name: "different" },
        manifest,
      }),
    ).toThrow(/D1/iu);
  });
});

describe("stable upstream selection", () => {
  it("selects a newer non-draft, non-prerelease SemVer release", () => {
    expect(
      selectStableUpgrade({
        currentVersion: "0.1.0",
        release: {
          tag_name: "v0.2.0",
          draft: false,
          prerelease: false,
          html_url:
            "https://github.com/UniMailbox/unimailbox-deploy/releases/tag/v0.2.0",
          body: "Upgrade notes",
        },
      }),
    ).toMatchObject({ version: "0.2.0", tag: "v0.2.0" });
  });

  it.each([
    [{ tag_name: "v0.2.0", draft: true, prerelease: false }, /stable/iu],
    [{ tag_name: "v0.2.0-beta.1", prerelease: true }, /stable/iu],
    [{ tag_name: "main", prerelease: false }, /SemVer/iu],
    [{ tag_name: "v0.1.0", prerelease: false }, /newer/iu],
    [{ tag_name: "v0.0.9", prerelease: false }, /newer/iu],
  ])("rejects an unsafe latest release", (release, error) => {
    expect(() =>
      selectStableUpgrade({
        currentVersion: "0.1.0",
        release: { draft: false, ...release },
      }),
    ).toThrow(error);
  });

  it("rejects an invalid installed version and defaults optional release text", () => {
    expect(() =>
      selectStableUpgrade({
        currentVersion: "development",
        release: { tag_name: "v1.0.0", draft: false, prerelease: false },
      }),
    ).toThrow(/current version/iu);
    expect(
      selectStableUpgrade({
        currentVersion: "0.1.0",
        release: { tag_name: "v1.0.0", draft: false, prerelease: false },
      }),
    ).toMatchObject({ releaseUrl: "", releaseNotes: "" });
  });
});

describe("upstream merge reporting", () => {
  it("parses tag-sourced JSONC without damaging comment-like strings", () => {
    expect(
      parseJsonc(`{
        // distribution snapshot
        "url": "https://example.com/a//b",
        "flags": ["one",],
      }`),
    ).toEqual({ url: "https://example.com/a//b", flags: ["one"] });
  });

  it("extracts unique conflicted paths from an unmerged index", () => {
    expect(
      parseConflictPaths(
        [
          `100644 ${"a".repeat(40)} 1\tapps/a.ts`,
          `100644 ${"b".repeat(40)} 2\tapps/a.ts`,
          `100644 ${"c".repeat(40)} 3\tapps/b.ts`,
        ].join("\n"),
      ),
    ).toEqual(["apps/a.ts", "apps/b.ts"]);
    expect(parseConflictPaths("")).toEqual([]);
  });

  it("builds a PR body with migrations, configuration changes and validation", () => {
    const body = buildUpgradePrBody({
      fromVersion: "0.1.0",
      toVersion: "0.2.0",
      releaseUrl: "https://example.com/release",
      releaseNotes: "Breaking: rotate a value.",
      migrations: ["0002_add_index.sql"],
      configurationChanges: ["wrangler.jsonc"],
      validation: ["pnpm typecheck: passed", "pnpm test: passed"],
    });
    expect(body).toContain("0.1.0 → 0.2.0");
    expect(body).toContain("0002_add_index.sql");
    expect(body).toContain("wrangler.jsonc");
    expect(body).toContain("Breaking: rotate a value.");
    expect(body).toContain("pnpm test: passed");
  });

  it("renders explicit empty sections and validates GitHub/JSON inputs", () => {
    expect(
      buildUpgradePrBody({
        fromVersion: "1.0.0",
        toVersion: "1.0.1",
        migrations: [],
        configurationChanges: [],
        validation: [],
      }),
    ).toContain("- Not run");
    expect(parseGitHubRepository(" customer/mail ")).toBe("customer/mail");
    expect(() => parseGitHubRepository("customer")).toThrow(/owner\/name/iu);
    expect(parseJsonOutput('{"ok":true}', "fixture")).toEqual({ ok: true });
    expect(() => parseJsonOutput("not-json", "fixture")).toThrow(
      /fixture returned invalid JSON/iu,
    );
  });
});
