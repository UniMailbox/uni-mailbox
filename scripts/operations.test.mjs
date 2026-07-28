import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const runbook = readFileSync(
  new URL("../docs/runbooks/attachment-storage-migration.md", import.meta.url),
  "utf8",
);
const deployment = readFileSync(
  new URL("../docs/deployment.md", import.meta.url),
  "utf8",
);
const defaultWrangler = readFileSync(
  new URL("../wrangler.jsonc", import.meta.url),
  "utf8",
);
const r2Wrangler = readFileSync(
  new URL("../wrangler.r2.jsonc", import.meta.url),
  "utf8",
);

describe("R2 operational commands", () => {
  it("deploys production and preview explicitly", () => {
    expect(packageJson.scripts["deploy:r2"]).toBe(
      "pnpm deploy:r2:production && pnpm deploy:r2:preview",
    );
    expect(packageJson.scripts["deploy:r2:production"]).toContain('--env ""');
    expect(packageJson.scripts["deploy:r2:preview"]).toContain("--env preview");
    expect(packageJson.scripts["deploy:r2:dry-run"]).toBe(
      "node scripts/r2-dry-run.mjs",
    );
  });

  it("documents commands supported by pinned Wrangler", () => {
    expect(runbook).toContain("wrangler kv namespace list");
    expect(runbook).toContain("wrangler kv key list");
    expect(runbook).not.toMatch(/wrangler kv:/u);
    expect(runbook).not.toContain("wrangler r2 object list");
    expect(deployment).not.toMatch(/wrangler kv:/u);
  });

  it("documents the read fallback and sequential preview deployment accurately", () => {
    expect(runbook).toMatch(/R2 first and then falls back to\s+KV/u);
    expect(deployment).toContain("deploy:r2:preview");
    expect(deployment).not.toContain(
      "`pnpm deploy:r2` also deploys the preview environment",
    );
  });

  it("keeps version preview URLs enabled for release verification", () => {
    for (const config of [defaultWrangler, r2Wrangler]) {
      expect(config.match(/"preview_urls": true/gu)).toHaveLength(2);
    }
  });
});
