import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { PermissionKey, SessionProfile } from "@unimailbox/contracts";
import { ApiClientError, setAccessToken } from "./api/index";
import { authKeys, sessionQueryOptions } from "../features/auth/api";

export const SESSION_QUERY_KEY = authKeys.session();

/**
 * Resolves the signed-in operator from the Worker.
 *
 * This is deliberately the *only* source of truth for "am I signed in". The
 * presence of an access token in sessionStorage is not enough: the token may be
 * expired, revoked, or absent while a valid refresh cookie still exists. The
 * request goes through the contract-aware API client, so a missing/expired access token is
 * transparently upgraded via the refresh cookie before we conclude anything.
 *
 * `retry: false` is required — retrying a 401 just delays the login redirect.
 */
export function useSession(): UseQueryResult<SessionProfile, unknown> {
  return useQuery(sessionQueryOptions());
}

/** True when the failure means "not signed in" rather than "server problem". */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

export function hasPermission(
  session: SessionProfile | undefined,
  permission: PermissionKey,
): boolean {
  return session?.permissions.includes(permission) ?? false;
}

/**
 * Drop every trace of the outgoing operator from this tab.
 *
 * Every sign-out path must call this. Clearing the whole cache — not just the
 * session entry — matters for two reasons: a cached `session` marked fresh
 * would let the route guard wave the signed-out visitor straight back into the
 * dashboard, and cached message/mailbox pages would otherwise be visible to
 * whoever signs in next on a shared machine.
 */
export function endSession(queryClient: QueryClient): void {
  setAccessToken(null);
  queryClient.clear();
}
