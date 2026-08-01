export const anonymousSessionError = {
  error: {
    code: "AUTH_REQUIRED",
    message: "Authentication required",
    requestId: "e2e-anonymous-session",
  },
};

export function sessionProfile(permissions: string[]) {
  return {
    userId: "operator-1",
    email: "operator@example.com",
    permissions,
  };
}
