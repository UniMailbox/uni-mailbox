import {
  ADMINISTRATOR_PERMISSIONS,
  MEMBER_PERMISSIONS,
  type SessionProfile,
} from "@unimailbox/contracts";
import { ADMIN_EMAIL, MEMBER_EMAIL } from "./ids";

/**
 * Session factories that mirror the Worker contract.
 *
 * Permissions come from `@unimailbox/contracts` so the test cannot drift from
 * the real permission set: a new permission added to the package is reflected
 * here automatically; one removed from a member default causes a typed
 * failure.
 */
export function memberSession(
  overrides: Partial<SessionProfile> = {},
): SessionProfile {
  return {
    userId: "user-member-1",
    email: MEMBER_EMAIL,
    permissions: [...MEMBER_PERMISSIONS],
    ...overrides,
  };
}

export function adminSession(
  overrides: Partial<SessionProfile> = {},
): SessionProfile {
  return {
    userId: "user-admin-1",
    email: ADMIN_EMAIL,
    permissions: [...ADMINISTRATOR_PERMISSIONS],
    ...overrides,
  };
}
