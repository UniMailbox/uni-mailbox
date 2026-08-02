import { pbkdf2, randomBytes as nodeRandomBytes } from "node:crypto";
import { promisify } from "node:util";

const derivePassword = promisify(pbkdf2);

export const WORKERS_PBKDF2_MAX_ITERATIONS = 100_000;

export const runtimeSecretNames = [
  "AUTH_SIGNING_KEY",
  "CREDENTIAL_ENCRYPTION_KEY",
];

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

export function reconcileRuntimeSecretNames(
  existingNames,
  randomBytes = (length) => nodeRandomBytes(length),
) {
  if (
    !Array.isArray(existingNames) ||
    existingNames.some((name) => typeof name !== "string")
  ) {
    throw new Error("Remote runtime secret state is unavailable");
  }
  const existing = new Set(existingNames);
  return Object.fromEntries(
    runtimeSecretNames
      .filter((name) => !existing.has(name))
      .map((name) => [name, base64Url(randomBytes(32))]),
  );
}

export function validateInitialAdministrator(environment) {
  const email = environment.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const password = environment.INITIAL_ADMIN_PASSWORD ?? "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error("INITIAL_ADMIN_EMAIL must be a valid email address");
  }
  if (password.length < 12 || password.length > 1024) {
    throw new Error(
      "INITIAL_ADMIN_PASSWORD must contain 12 to 1024 characters",
    );
  }
  return { email, password };
}

export async function createPasswordRecord(
  password,
  {
    randomBytes = (length) => nodeRandomBytes(length),
    iterations = WORKERS_PBKDF2_MAX_ITERATIONS,
  } = {},
) {
  const salt = randomBytes(16);
  const hash = await derivePassword(password, salt, iterations, 32, "sha256");
  return {
    hash: base64Url(hash),
    salt: base64Url(salt),
    algorithm: "pbkdf2-sha256",
    iterations,
  };
}

export function createAdministratorPasswordRepairSql({
  email,
  force = false,
  passwordRecord,
}) {
  const administratorRoleId = "00000000-0000-4000-8000-000000000001";
  const repairGuard = force
    ? ""
    : `
  AND (
    password_algorithm <> 'pbkdf2-sha256'
    OR password_iterations <= 0
    OR password_iterations > ${WORKERS_PBKDF2_MAX_ITERATIONS}
  )`;
  return `UPDATE users
SET password_hash = ${sqlLiteral(passwordRecord.hash)},
    password_algorithm = ${sqlLiteral(passwordRecord.algorithm)},
    password_salt = ${sqlLiteral(passwordRecord.salt)},
    password_iterations = ${Number(passwordRecord.iterations)},
    updated_at = CURRENT_TIMESTAMP
WHERE email = ${sqlLiteral(email)} COLLATE NOCASE
  AND EXISTS (
    SELECT 1
    FROM user_roles administrator_role
    WHERE administrator_role.user_id = users.id
      AND administrator_role.role_id = '${administratorRoleId}'
  )${repairGuard};

UPDATE sessions
SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
WHERE user_id IN (
  SELECT administrator.id
  FROM users administrator
  JOIN user_roles administrator_role
    ON administrator_role.user_id = administrator.id
  WHERE administrator.email = ${sqlLiteral(email)} COLLATE NOCASE
    AND administrator_role.role_id = '${administratorRoleId}'
);
`;
}

export function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function createAdministratorBootstrapSql({
  userId,
  email,
  displayName,
  passwordRecord,
}) {
  const administratorRoleId = "00000000-0000-4000-8000-000000000001";
  return `INSERT INTO users (
  id, email, password_hash, password_algorithm, password_salt,
  password_iterations, status, display_name
)
SELECT
  ${sqlLiteral(userId)},
  ${sqlLiteral(email)},
  ${sqlLiteral(passwordRecord.hash)},
  ${sqlLiteral(passwordRecord.algorithm)},
  ${sqlLiteral(passwordRecord.salt)},
  ${Number(passwordRecord.iterations)},
  'active',
  ${sqlLiteral(displayName)}
WHERE NOT EXISTS (
  SELECT 1
  FROM users existing_user
  JOIN user_roles existing_role ON existing_role.user_id = existing_user.id
  WHERE existing_role.role_id = '${administratorRoleId}'
);

INSERT INTO user_roles (user_id, role_id)
SELECT ${sqlLiteral(userId)}, '${administratorRoleId}'
WHERE EXISTS (
  SELECT 1 FROM users WHERE id = ${sqlLiteral(userId)}
)
AND NOT EXISTS (
  SELECT 1 FROM user_roles WHERE role_id = '${administratorRoleId}'
);

UPDATE installation_state
SET status = 'complete',
    current_step = 'complete',
    completed_steps_json = '["admin_bootstrap"]',
    state_version = state_version + 1,
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1
  AND EXISTS (
    SELECT 1
    FROM users administrator
    JOIN user_roles administrator_role
      ON administrator_role.user_id = administrator.id
    WHERE administrator_role.role_id = '${administratorRoleId}'
  );
`;
}
