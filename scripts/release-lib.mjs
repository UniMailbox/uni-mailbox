const versionIdPattern = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/iu;
const previewUrlPattern = /https:\/\/[^\s]+\.workers\.dev/iu;

function structuredVersionUpload(outputFile) {
  const entries = outputFile
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  return entries.findLast((entry) => entry?.type === "version-upload");
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
