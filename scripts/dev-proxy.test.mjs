/**
 * The local dev loop only works if the Vite proxy points at the same port
 * that `wrangler dev` listens on. When they drift, every request from the web
 * client returns a connection error and the login form appears to do nothing.
 *
 * This test reads the two sources of truth and asserts they agree. It exists
 * because the drift was a real regression: the proxy was pinned to 8788 while
 * wrangler was 8787 (and vice-versa), and the symptom was identical from the
 * UI's perspective.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

function readViteProxy() {
  const source = readFileSync(
    resolve(repoRoot, "apps/web/vite.config.ts"),
    "utf8",
  );
  // A single regex is enough — both /api and /health use the same target.
  const match = source.match(
    new RegExp('"/api":\\s*"http://127\\.0\\.0\\.1:(\\d+)"'),
  );
  if (!match) {
    throw new Error("could not find /api proxy target in vite.config.ts");
  }
  return Number.parseInt(match[1], 10);
}

function readWranglerDevPort() {
  const source = readFileSync(resolve(repoRoot, "wrangler.jsonc"), "utf8");
  const match = source.match(new RegExp('"port":\\s*(\\d+)'));
  if (!match) {
    throw new Error("could not find dev.port in wrangler.jsonc");
  }
  return Number.parseInt(match[1], 10);
}

describe("local dev proxy ↔ worker port", () => {
  it("agrees on the same port", () => {
    const vitePort = readViteProxy();
    const workerPort = readWranglerDevPort();
    expect(vitePort).toBe(workerPort);
  });

  it("uses the documented Cloudflare local-dev port", () => {
    // The docs and the local-admin-bootstrap runbook all hard-code 8787, so
    // changing the port is a documentation break the reader cannot recover
    // from without digging through the source.
    expect(readViteProxy()).toBe(8787);
    expect(readWranglerDevPort()).toBe(8787);
  });
});
