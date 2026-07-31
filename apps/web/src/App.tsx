import { lazy, Suspense, useEffect } from "react";
import {
  ADMIN_RESOURCE_PERMISSIONS,
  type AdminResourceKey,
} from "@unimailbox/contracts";
import { redirect, useLocation } from "./lib/navigation";
import { LoadingState } from "./components/Status";
import {
  RedirectIfSignedIn,
  RequireSession,
} from "./features/auth/RequireSession";

const LoginPage = lazy(() =>
  import("./features/auth/LoginPage").then((module) => ({
    default: module.LoginPage,
  })),
);
const MailWorkspace = lazy(() =>
  import("./features/mail/MailWorkspace").then((module) => ({
    default: module.MailWorkspace,
  })),
);
const MessagePage = lazy(() =>
  import("./features/mail/MessagePage").then((module) => ({
    default: module.MessagePage,
  })),
);
const AdminPage = lazy(() =>
  import("./features/admin/AdminPage").then((module) => ({
    default: module.AdminPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);

const folders = new Set([
  "inbox",
  "sent",
  "drafts",
  "starred",
  "archive",
  "trash",
]);

// Map `/admin/<segment>` directly to the `AdminResource` discriminator that
// `AdminPage` consumes. Any unknown segment falls back to "users".
// `ADMIN_RESOURCE_PERMISSIONS` is the shared contract that also tells the route
// guard which permission the Worker will demand, so the client refuses to
// render a page that could only ever return 403.
const adminResources = ADMIN_RESOURCE_PERMISSIONS;

const settingsSections = {
  mailboxes: "mailboxes",
  cloudflare: "cloudflare",
  storage: "storage",
  account: "account",
} as const;

function resolveAdminResource(segment: string | undefined): AdminResourceKey {
  if (segment && segment in adminResources) {
    return segment as AdminResourceKey;
  }
  return "users";
}

function resolveSettingsSection(
  segment: string | undefined,
): keyof typeof settingsSections {
  if (segment && segment in settingsSections) {
    return settingsSections[segment as keyof typeof settingsSections];
  }
  return "account";
}

export function App() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);

  useEffect(() => {
    if (pathname === "/") redirect("/inbox");
    if (pathname === "/setup") redirect("/login");
  }, [pathname]);

  let page: React.ReactNode;
  if (pathname === "/setup") page = null;
  else if (pathname === "/login" || pathname === "/register") {
    page = (
      <RedirectIfSignedIn>
        <LoginPage />
      </RedirectIfSignedIn>
    );
  } else if (segments[0] === "messages" && segments[1]) {
    page = (
      <RequireSession>
        <MessagePage messageId={segments[1]} />
      </RequireSession>
    );
  } else if (segments[0] === "admin") {
    const resource = resolveAdminResource(segments[1]);
    page = (
      <RequireSession permission={adminResources[resource]}>
        <AdminPage resource={resource} />
      </RequireSession>
    );
  } else if (segments[0] === "settings") {
    page = (
      <RequireSession>
        <SettingsPage section={resolveSettingsSection(segments[1])} />
      </RequireSession>
    );
  } else {
    const folder = folders.has(segments[0] ?? "") ? segments[0] : "inbox";
    page = (
      <RequireSession>
        <MailWorkspace folder={folder} routeMailboxId={segments[1]} />
      </RequireSession>
    );
  }

  return (
    <Suspense fallback={<LoadingState label="Loading workspace" />}>
      {page}
    </Suspense>
  );
}
