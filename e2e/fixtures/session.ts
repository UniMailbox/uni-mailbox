import type { SessionProfile } from "../../packages/contracts/src/api/auth";
import type { PermissionKey } from "../../packages/contracts/src/domain";

export const anonymousSessionError = {
  error: {
    code: "AUTH_REQUIRED",
    message: "Authentication required",
    requestId: "e2e-anonymous-session",
  },
};

export function sessionProfile(permissions: PermissionKey[]): SessionProfile {
  return {
    userId: "operator-1",
    email: "operator@example.com",
    permissions,
  };
}
