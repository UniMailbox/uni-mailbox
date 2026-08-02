const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function names(entries) {
  return new Set((entries ?? []).map((entry) => entry.name));
}

export function validateProductionEnvironment({
  environment,
  branchPolicies,
  variables,
  secrets,
  adminBypassConfirmed = false,
}) {
  if (environment?.name !== "production") {
    throw new Error('GitHub Environment "production" is required');
  }
  if (environment.can_admins_bypass === true) {
    throw new Error("production must disable administrator bypass");
  }
  if (
    environment.can_admins_bypass !== false &&
    adminBypassConfirmed !== true
  ) {
    throw new Error(
      "GitHub does not expose administrator bypass through this API; verify the Environment setting and rerun with --confirm-admin-bypass-disabled",
    );
  }
  const reviewerRule = environment.protection_rules?.find(
    (rule) => rule.type === "required_reviewers",
  );
  if (!reviewerRule?.reviewers?.length) {
    throw new Error("production must have at least one required reviewer");
  }
  if (reviewerRule.prevent_self_review !== true) {
    throw new Error("production must prevent self review");
  }
  const branchPolicy = environment.deployment_branch_policy;
  if (
    branchPolicy?.protected_branches !== false ||
    branchPolicy?.custom_branch_policies !== true
  ) {
    throw new Error("production must use a custom deployment branch policy");
  }
  if (branchPolicies?.length !== 1 || branchPolicies[0]?.name !== "main") {
    throw new Error("production deployment policy must allow only main");
  }

  const deploymentVariable = variables?.find(
    (variable) => variable.name === "DEPLOYMENT_URL",
  );
  const deploymentUrl = new URL(
    requireString(deploymentVariable?.value, "DEPLOYMENT_URL variable"),
  );
  if (deploymentUrl.protocol !== "https:") {
    throw new Error("DEPLOYMENT_URL must use HTTPS");
  }
  const secretNames = names(secrets);
  for (const required of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    if (!secretNames.has(required)) {
      throw new Error(`production Environment secret ${required} is required`);
    }
  }
  return {
    deploymentUrl: deploymentUrl.origin,
    adminBypassVerification:
      environment.can_admins_bypass === false
        ? "github_api"
        : "operator_attestation",
  };
}

export function assertDeploymentCredentials(environment) {
  for (const required of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    requireString(environment?.[required], required);
  }
  return { configured: true };
}

export function validateCloudflareResolution({ versions, d1, manifest }) {
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error(
      `Wrangler could not resolve Worker ${manifest?.worker?.name ?? "(unknown)"}`,
    );
  }
  const expectedD1 = manifest?.resources?.d1;
  const resolvedId = d1?.uuid ?? d1?.database_id ?? d1?.id;
  if (
    !expectedD1 ||
    resolvedId !== expectedD1.id ||
    d1?.name !== expectedD1.name
  ) {
    throw new Error(
      "Wrangler resolved a D1 database that does not match adoption",
    );
  }
  return { worker: true, d1: true };
}

function semverParts(version, label) {
  const match = STABLE_SEMVER.exec(requireString(version, label));
  if (!match) throw new Error(`${label} must be a stable SemVer version`);
  return match.slice(1).map(Number);
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function selectStableUpgrade({ currentVersion, release }) {
  if (release?.draft === true || release?.prerelease === true) {
    throw new Error("latest release is not a stable release");
  }
  const tag = requireString(release?.tag_name, "release tag");
  if (!tag.startsWith("v")) {
    throw new Error("release tag must be v-prefixed stable SemVer");
  }
  const version = tag.slice(1);
  const current = semverParts(currentVersion, "current version");
  const next = semverParts(version, "release SemVer");
  if (compareSemver(next, current) <= 0) {
    throw new Error(
      "latest stable release must be newer than the installation",
    );
  }
  return {
    version,
    tag,
    releaseUrl: release.html_url ?? "",
    releaseNotes: release.body ?? "",
  };
}

export function parseConflictPaths(indexOutput) {
  return [
    ...new Set(
      (indexOutput ?? "")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("\t")[1])
        .filter(Boolean),
    ),
  ].sort();
}

function bulletList(values, emptyText = "None") {
  return values?.length
    ? values.map((value) => `- ${value}`).join("\n")
    : `- ${emptyText}`;
}

export function buildUpgradePrBody({
  fromVersion,
  toVersion,
  releaseUrl,
  releaseNotes,
  migrations,
  configurationChanges,
  validation,
}) {
  return `## UniMailbox stable upgrade

${fromVersion} → ${toVersion}${releaseUrl ? ` ([release](${releaseUrl}))` : ""}

### Release notes

${releaseNotes?.trim() || "No release notes supplied."}

### Migrations

${bulletList(migrations)}

### Configuration changes

${bulletList(configurationChanges)}

### Validation

${bulletList(validation, "Not run")}

Merging this PR does not deploy production. Run the protected production workflow and approve the \`production\` Environment separately.
`;
}

export function parseGitHubRepository(value) {
  const repository = requireString(value, "GitHub repository");
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new Error("GitHub repository must use owner/name format");
  }
  return repository;
}

export function parseJsonOutput(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}
