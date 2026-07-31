import { createRootRouteWithContext, createRoute, createRouter, createBrowserHistory, Outlet, redirect, notFound, type RouterHistory, useParams } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { ADMIN_RESOURCE_PERMISSIONS } from "@unimailbox/contracts";
import { ApiClientError } from "../lib/api/errors";
import { sessionQueryOptions } from "../features/auth/api";
import { LoginPage } from "../features/auth/LoginPage";
import { MailWorkspace } from "../features/mail/MailWorkspace";
import { MessagePage } from "../features/mail/MessagePage";
import { AdminPage } from "../features/admin/AdminPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { ForbiddenRouteError, RouteErrorBoundary, RouteNotFoundBoundary } from "../routes/boundaries";
import { App } from "../App";

export interface RouterContext { queryClient: QueryClient }
export const DEFAULT_AFTER_LOGIN = "/inbox";

export function safeLoginTarget(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return DEFAULT_AFTER_LOGIN;
  if (/^\/[/\\\\]/u.test(value) || value.includes("\\")) return DEFAULT_AFTER_LOGIN;
  if (/^\/(login|register)(?:\/|\?|$)/u.test(value)) return DEFAULT_AFTER_LOGIN;
  return value;
}

function loginSearch(search: Record<string, unknown>) {
  return { next: safeLoginTarget(search.next) === DEFAULT_AFTER_LOGIN ? undefined : safeLoginTarget(search.next) };
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: App,
  errorComponent: RouteErrorBoundary,
  notFoundComponent: RouteNotFoundBoundary,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "login",
  validateSearch: loginSearch,
  beforeLoad: async ({ context, search }) => {
    try {
      await context.queryClient.ensureQueryData(sessionQueryOptions());
      throw redirect({ to: safeLoginTarget(search.next), replace: true });
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) return;
      throw error;
    }
  },
  component: LoginPage,
});

const registerRoute = createRoute({ getParentRoute: () => rootRoute, path: "register", validateSearch: loginSearch, component: LoginPage });
const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: "setup", beforeLoad: () => { throw redirect({ to: "/login", replace: true }); } });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", beforeLoad: () => { throw redirect({ to: "/inbox", replace: true }); } });

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  component: Outlet,
  beforeLoad: async ({ context, location }) => {
    try {
      return { session: await context.queryClient.ensureQueryData(sessionQueryOptions()) };
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        throw redirect({ to: "/login", search: { next: safeLoginTarget(location.href) }, replace: true });
      }
      throw error;
    }
  },
});

const folders = ["inbox", "sent", "drafts", "starred", "archive", "trash"] as const;
function FolderRoute({ folder }: { folder: (typeof folders)[number] }) {
  const { mailboxId } = useParams({ strict: false }) as { mailboxId?: string };
  return <MailWorkspace folder={folder} routeMailboxId={mailboxId} />;
}
function MessageRoute() {
  const { messageId } = useParams({ strict: false }) as { messageId: string };
  return <MessagePage messageId={messageId} />;
}
function AdminRoute() {
  const { resource } = useParams({ strict: false }) as { resource: keyof typeof ADMIN_RESOURCE_PERMISSIONS };
  return <AdminPage resource={resource} />;
}
function SettingsRoute() {
  const { section } = useParams({ strict: false }) as { section: "account" | "mailboxes" | "cloudflare" | "storage" };
  return <SettingsPage section={section} />;
}
const folderRoutes = folders.flatMap((folder) => [
  createRoute({ getParentRoute: () => authenticatedRoute, path: folder, component: () => <FolderRoute folder={folder} /> }),
  createRoute({ getParentRoute: () => authenticatedRoute, path: `${folder}/$mailboxId`, component: () => <FolderRoute folder={folder} /> }),
]);
const messageRoute = createRoute({ getParentRoute: () => authenticatedRoute, path: "messages/$messageId", component: MessageRoute });
const adminRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "admin/$resource",
  beforeLoad: ({ context, params }) => {
    if (!(params.resource in ADMIN_RESOURCE_PERMISSIONS)) throw notFound();
    const resource = params.resource as keyof typeof ADMIN_RESOURCE_PERMISSIONS;
    const permission = ADMIN_RESOURCE_PERMISSIONS[resource];
    if (!context.session.permissions.includes(permission)) throw new ForbiddenRouteError(permission);
  },
  component: AdminRoute,
});
const settingsRoute = createRoute({ getParentRoute: () => authenticatedRoute, path: "settings/$section", component: SettingsRoute });
const settingsIndexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "settings",
  beforeLoad: () => { throw redirect({ to: "/settings/account", replace: true }); },
});

const routeTree = rootRoute.addChildren([indexRoute, setupRoute, loginRoute, registerRoute, authenticatedRoute.addChildren([...folderRoutes, messageRoute, adminRoute, settingsRoute, settingsIndexRoute])]);

export function createAppRouter({ queryClient, history }: { queryClient: QueryClient; history?: RouterHistory }) {
  return createRouter({ routeTree, context: { queryClient }, history: history ?? createBrowserHistory() });
}
