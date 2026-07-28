#!/usr/bin/env node
import { fail, output } from "./_shared.mjs";

const rawUrl = process.argv[2];
if (!rawUrl) {
  fail(
    "verify.usage",
    "Usage: pnpm release:verify <https://deployment-url>",
    2,
  );
}
const baseUrl = new URL(rawUrl);
if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") {
  fail("verify.url_invalid", "Deployment verification requires HTTPS", 2);
}

async function check(path, acceptedStatuses = [200]) {
  const startedAt = Date.now();
  const response = await fetch(new URL(path, baseUrl), {
    redirect: "manual",
    headers: { "user-agent": "unimailbox-release-verifier/1" },
    signal: AbortSignal.timeout(15_000),
  });
  const result = {
    path,
    status: response.status,
    durationMs: Date.now() - startedAt,
  };
  output("verify.http", result);
  if (!acceptedStatuses.includes(response.status)) {
    fail(
      "verify.http_failed",
      `${path} returned ${response.status}`,
      9,
      result,
    );
  }
  return response;
}

const health = await check("/health");
const healthBody = await health.json();
if (healthBody?.data?.status !== "ok") {
  fail("verify.health_failed", "Health response is not ok", 9);
}
await check("/login");
await check("/", [200, 307]);
output("verify.completed", {
  status: "ok",
  url: baseUrl.origin,
  note: "Authenticated, queue, inbound-routing, and provider smoke tests remain operator-gated",
});
