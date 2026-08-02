export function validateHealthRelease(body, expectedVersion) {
  if (body?.data?.status !== "ok") {
    throw new Error("Health response status is not ok");
  }
  const checks = body.data.checks ?? {};
  for (const binding of ["database", "kv", "queue", "assets"]) {
    if (checks[binding] !== "ok") {
      throw new Error(`Required ${binding} health check is not ok`);
    }
  }
  const release = body.data.release;
  if (release?.applicationVersion !== expectedVersion) {
    throw new Error(
      `applicationVersion ${release?.applicationVersion ?? "missing"} does not match ${expectedVersion}`,
    );
  }
  if (release?.upstreamVersion !== expectedVersion) {
    throw new Error(
      `upstreamVersion ${release?.upstreamVersion ?? "missing"} does not match ${expectedVersion}`,
    );
  }
  if (!release.workerVersionId || !release.deployedAt) {
    throw new Error("Worker version metadata is missing");
  }
  const warnings = [];
  if (checks.scheduled !== "ok") {
    warnings.push(`scheduled trigger is ${checks.scheduled ?? "missing"}`);
  }
  return { warnings };
}
