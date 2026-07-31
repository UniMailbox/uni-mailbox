import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";
import type { PermissionKey } from "@unimailbox/contracts";
import { ErrorState, LoadingState } from "../../components/Status";
import {
  Link,
  loginPathFor,
  postLoginTarget,
  redirect,
  useLocation,
} from "../../lib/navigation";
import {
  hasPermission,
  isUnauthenticated,
  useSession,
} from "../../lib/session";

/**
 * Gate for every route that assumes a signed-in operator.
 *
 * The Worker is the real authority — each API route runs `requireAuth` and the
 * permission assertions in the administration service. This guard exists so an
 * unauthenticated visitor sees the login page instead of a dashboard shell that
 * fires a burst of doomed requests and then paints a wall of 401 errors.
 *
 * The four states are deliberately distinct:
 *   pending  → nothing is rendered yet; we do not know who this is.
 *   401      → not signed in: replace the URL with /login?next=<intended>.
 *   other    → the deployment is unhealthy (503 during bootstrap, 5xx). Show
 *              the error instead of bouncing to login, which would hide it.
 *   resolved → render, unless a specific permission is missing.
 */
export function RequireSession({
  children,
  permission,
}: {
  children: React.ReactNode;
  permission?: PermissionKey;
}) {
  const { pathname, search } = useLocation();
  const session = useSession();
  const unauthenticated = session.isError && isUnauthenticated(session.error);

  useEffect(() => {
    if (unauthenticated) redirect(loginPathFor(pathname, search));
  }, [unauthenticated, pathname, search]);

  if (session.isPending) {
    return <LoadingState label="Checking your session" />;
  }

  if (unauthenticated) {
    // The effect above is already replacing the URL; render nothing rather
    // than flashing protected chrome for a frame.
    return null;
  }

  if (session.isError) {
    return <ErrorState error={session.error} retry={() => session.refetch()} />;
  }

  if (permission && !hasPermission(session.data, permission)) {
    return <PermissionDenied permission={permission} />;
  }

  return <>{children}</>;
}

/**
 * Shown when the operator is signed in but lacks the permission for this page.
 * A redirect to /login would be wrong and confusing here — the session is
 * valid, signing in again changes nothing.
 */
function PermissionDenied({ permission }: { permission: PermissionKey }) {
  return (
    <main className="state-page">
      <div className="state-card error-state" role="alert">
        <ShieldAlert aria-hidden="true" />
        <div>
          <strong>You do not have access to this area</strong>
          <p>
            This page requires the <code>{permission}</code> permission. Ask an
            administrator to grant it, or return to your mail.
          </p>
        </div>
        <Link className="button secondary" to="/inbox">
          Back to inbox
        </Link>
      </div>
    </main>
  );
}

/**
 * Inverse gate for the login route: an operator who already has a valid session
 * should not be shown a sign-in form. Without this, signing in, pressing Back,
 * and signing in again produces a confusing double-login.
 */
export function RedirectIfSignedIn({
  children,
}: {
  children: React.ReactNode;
}) {
  const { search } = useLocation();
  const session = useSession();
  const signedIn = session.isSuccess;

  useEffect(() => {
    if (signedIn) redirect(postLoginTarget(search));
  }, [signedIn, search]);

  if (session.isPending) {
    return <LoadingState label="Checking your session" />;
  }
  if (signedIn) return null;
  return <>{children}</>;
}
