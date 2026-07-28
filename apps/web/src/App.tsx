import { lazy, Suspense, useEffect } from "react";
import { navigate, usePathname } from "./lib/navigation";
import { LoadingState } from "./components/Status";

const SetupPage = lazy(() =>
  import("./features/setup/SetupPage").then((module) => ({
    default: module.SetupPage,
  })),
);
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

export function App() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  useEffect(() => {
    if (pathname === "/") navigate("/inbox");
  }, [pathname]);

  let page: React.ReactNode;
  if (pathname === "/setup") page = <SetupPage />;
  else if (pathname === "/login" || pathname === "/register")
    page = <LoginPage />;
  else if (segments[0] === "messages" && segments[1]) {
    page = <MessagePage messageId={segments[1]} />;
  } else if (segments[0] === "admin") {
    const resource =
      segments[1] === "signatures"
        ? "signatures"
        : segments[1] === "provider-connections"
          ? "provider-connections"
          : segments[1] === "webhook-events"
            ? "webhook-events"
            : segments[1] === "audit-events"
              ? "audit-events"
              : segments[1] === "analytics"
                ? "analytics"
                : segments[1] === "roles"
                  ? "roles"
                  : segments[1] === "domains"
                    ? "domains"
                    : segments[1] === "settings"
                      ? "settings"
                      : "users";
    page = <AdminPage resource={resource} />;
  } else if (segments[0] === "settings") {
    page = (
      <SettingsPage
        section={segments[1] === "mailboxes" ? "mailboxes" : "account"}
      />
    );
  } else {
    const folder = folders.has(segments[0] ?? "") ? segments[0] : "inbox";
    page = <MailWorkspace folder={folder} routeMailboxId={segments[1]} />;
  }

  return (
    <Suspense fallback={<LoadingState label="Loading workspace" />}>
      {page}
    </Suspense>
  );
}
