const versionIdPattern = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/iu;
const previewUrlPattern = /https:\/\/[^\s]+\.workers\.dev/iu;

function parseStructuredOutput(outputFile) {
  const lines = outputFile.split(/\r?\n/u).filter(Boolean);
  const entries = [];
  let malformedLines = 0;
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      malformedLines += 1;
    }
  }
  return { entries, malformedLines };
}

function diagnosticExcerpt(value) {
  return value
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .replace(/(Authorization:\s*Bearer)\s+\S+/giu, "$1 [REDACTED]")
    .replace(/(CLOUDFLARE_API_TOKEN\s*[=:]\s*)\S+/giu, "$1[REDACTED]")
    .slice(0, 2_000);
}

function structuredVersionUpload(outputFile) {
  return parseStructuredOutput(outputFile).entries.findLast(
    (entry) => entry?.type === "version-upload",
  );
}

export function createVersionUploadDiagnostics({
  outputFileExists,
  outputFile,
  stdout,
  stderr,
}) {
  const { entries, malformedLines } = parseStructuredOutput(outputFile);
  return {
    outputFileExists,
    outputFileBytes: Buffer.byteLength(outputFile),
    outputEntryTypes: entries
      .map((entry) => entry?.type)
      .filter((type) => typeof type === "string"),
    malformedOutputLines: malformedLines,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    stdoutExcerpt: diagnosticExcerpt(stdout),
    stderrExcerpt: diagnosticExcerpt(stderr),
  };
}

export function selectProductionReleaseMode({ workerVersionId, previewUrl }) {
  return workerVersionId && previewUrl ? "verified-version" : "direct-deploy";
}

export function productionReleaseSteps(releaseMode) {
  const databaseSteps = [
    "capture-bookmark",
    "migrate-production",
    "verify-migrations",
    "bootstrap-administrator",
  ];
  return releaseMode === "verified-version"
    ? [...databaseSteps, "verify-candidate", "promote-version"]
    : [...databaseSteps, "deploy-direct"];
}

export function productionBranchFromEnvironment(environment) {
  return (
    [environment.WORKERS_CI_BRANCH, environment.GITHUB_REF_NAME].find(
      (branch) => typeof branch === "string" && branch.trim().length > 0,
    ) ?? undefined
  );
}

export function parseRuntimeSecretList(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Wrangler secret list did not return valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Wrangler secret list must return an array");
  }
  if (parsed.some((entry) => typeof entry?.name !== "string")) {
    throw new Error("Wrangler secret list must contain named entries");
  }
  return parsed.map((entry) => entry.name);
}

export function parseD1CountResult(raw, field) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("D1 count query did not return valid JSON");
  }
  const value = parsed?.[0]?.results?.[0]?.[field];
  if (
    parsed?.[0]?.success !== true ||
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`D1 count query did not return ${field}`);
  }
  return value;
}

export function parseVersionUploadResult({ outputFile, stdout, stderr }) {
  const structured = structuredVersionUpload(outputFile);
  const consoleOutput = `${stdout}\n${stderr}`;
  const workerVersionId =
    (typeof structured?.version_id === "string"
      ? structured.version_id
      : undefined) ??
    consoleOutput.match(
      /(?:Worker Version ID|Version ID)\s*:\s*([0-9a-f-]{36})/iu,
    )?.[1] ??
    consoleOutput.match(versionIdPattern)?.[0];
  const structuredPreviewUrl = [
    structured?.preview_alias_url,
    structured?.preview_url,
  ].find((value) => typeof value === "string");
  const previewUrl =
    structuredPreviewUrl ?? consoleOutput.match(previewUrlPattern)?.[0];

  return { workerVersionId, previewUrl };
}
