import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Check, LogOut, Menu, PenLine, Search } from "lucide-react";
import {
  findNavigationLeaf,
  getNavigationModel,
  isAuthenticatedMailPath,
  isNavigationGroupActive,
  type NavigationGroup,
} from "../lib/app-navigation";
import { endSession, useSession } from "../lib/session";
import { useUiStore } from "../lib/ui-store";
import { logoutMutationOptions } from "../features/auth/api";
import { mailboxesQueryOptions } from "../features/mail/api";
import { BidiText } from "./BidiText";

const ComposePanel = lazy(() =>
  import("../features/mail/ComposePanel").then((module) => ({
    default: module.ComposePanel,
  })),
);

interface AuthenticatedShellContextValue {
  activeMailboxId: string | null;
  search: string;
  setSearch: (value: string) => void;
}

const AuthenticatedShellContext =
  createContext<AuthenticatedShellContextValue | null>(null);

export function useAuthenticatedShell(): AuthenticatedShellContextValue | null {
  return useContext(AuthenticatedShellContext);
}

function initials(value: string): string {
  return value
    .split(/[\s@._-]+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function routeMailboxId(pathname: string): string | null {
  const match = pathname.match(/^\/(?:inbox|sent|archive|trash)\/([^/]+)/u);
  return match?.[1] ?? null;
}

function NavigationGroupView({
  group,
  pathname,
  onNavigate,
  translate,
  unreadCount,
}: {
  group: NavigationGroup;
  pathname: string;
  onNavigate: () => void;
  translate: (key: string) => string;
  unreadCount?: number;
}) {
  const GroupIcon = group.icon;
  const active = isNavigationGroupActive(group, pathname);
  return (
    <section
      aria-label={translate(group.labelKey)}
      className={`nav-group ${active ? "active" : ""}`}
    >
      <h2 className="nav-label nav-group-label">
        <GroupIcon aria-hidden="true" />
        <span>{translate(group.labelKey)}</span>
      </h2>
      <div className="nav-group-items">
        {group.children.map((item) => {
          const Icon = item.icon;
          const isActive = item.isActive(pathname);
          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={isActive ? "active" : ""}
              key={item.id}
              onClick={onNavigate}
              to={item.href as "/inbox"}
            >
              <Icon aria-hidden="true" />
              <span>{translate(item.labelKey)}</span>
              {item.id === "inbox" && unreadCount ? (
                <strong>{unreadCount.toLocaleString()}</strong>
              ) : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function AuthenticatedShell({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation("mail");
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const mailboxes = useQuery(mailboxesQueryOptions());
  const selectedMailboxId = useUiStore((state) => state.selectedMailboxId);
  const setSelectedMailboxId = useUiStore(
    (state) => state.setSelectedMailboxId,
  );
  const composeOpen = useUiStore((state) => state.composeOpen);
  const composeIntent = useUiStore((state) => state.composeIntent);
  const setComposeOpen = useUiStore((state) => state.setComposeOpen);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [search, setSearch] = useState("");
  const pathname = location.pathname;
  const activeRouteMailboxId = routeMailboxId(pathname);
  const activeMailboxId =
    activeRouteMailboxId ??
    selectedMailboxId ??
    mailboxes.data?.[0]?.id ??
    null;
  const activeMailbox = mailboxes.data?.find(
    (mailbox) => mailbox.id === activeMailboxId,
  );
  const permissions = session.data?.permissions ?? [];
  const navigation = getNavigationModel({
    pathname,
    mailboxId: activeMailboxId,
    permissions,
  });
  const activeLeaf = findNavigationLeaf(pathname, {
    mailboxId: activeMailboxId,
    permissions,
  });
  const showSearch = isAuthenticatedMailPath(pathname);
  const canCompose = true;
  const logout = useMutation({
    ...logoutMutationOptions(queryClient),
    onSettled: () => {
      endSession(queryClient);
      setSidebarOpen(false);
      setComposeOpen(false);
      void navigate({ to: "/login", replace: true });
    },
  });

  useEffect(() => {
    if (activeRouteMailboxId && activeRouteMailboxId !== selectedMailboxId) {
      setSelectedMailboxId(activeRouteMailboxId);
    }
  }, [activeRouteMailboxId, selectedMailboxId, setSelectedMailboxId]);

  useEffect(() => {
    if (!sidebarOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [setSidebarOpen, sidebarOpen]);

  useEffect(() => {
    if (sidebarOpen) return;
    const previouslyFocused = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    previouslyFocused?.focus();
  }, [sidebarOpen]);

  const closeSidebar = () => setSidebarOpen(false);
  const translate = (key: string) => t(key);

  return (
    <AuthenticatedShellContext.Provider
      value={{ activeMailboxId, search, setSearch }}
    >
      <div className="mail-app app-shell">
        <aside
          aria-label={t("navigation.folders")}
          className={`mail-sidebar app-sidebar ${sidebarOpen ? "open" : ""}`}
          id="authenticated-navigation"
        >
          <header>
            <Link
              className="wordmark compact"
              onClick={closeSidebar}
              to="/inbox"
            >
              <span>CM</span> UniMailbox
            </Link>
            <button
              aria-label={t("navigation.close")}
              className="sidebar-close"
              onClick={closeSidebar}
              ref={closeButtonRef}
              type="button"
            >
              ×
            </button>
          </header>
          {canCompose ? (
            <button
              className="compose-button"
              disabled={!activeMailboxId}
              onClick={() => setComposeOpen(true)}
              type="button"
            >
              <PenLine aria-hidden="true" /> {t("compose.panelLabel")}
            </button>
          ) : null}
          <nav>
            {navigation.map((group) => (
              <NavigationGroupView
                group={group}
                key={group.id}
                onNavigate={closeSidebar}
                pathname={pathname}
                translate={translate}
                unreadCount={activeMailbox?.unread_count ?? undefined}
              />
            ))}
          </nav>
          <footer>
            <span className="system-pulse" />
            <div>
              <strong>{t("system.nominal")}</strong>
              <small>{t("system.online")}</small>
            </div>
          </footer>
        </aside>
        {sidebarOpen ? (
          <button
            aria-label={t("navigation.close")}
            className="sidebar-backdrop"
            onClick={closeSidebar}
            type="button"
          />
        ) : null}
        <div className="mail-main app-main">
          <header className="mail-topbar app-topbar">
            <button
              aria-controls="authenticated-navigation"
              aria-expanded={sidebarOpen}
              aria-label={t("navigation.open")}
              className="icon-button mobile-menu"
              onClick={() => setSidebarOpen(true)}
              type="button"
            >
              <Menu aria-hidden="true" />
            </button>
            {showSearch ? (
              <label className="search-field">
                <Search aria-hidden="true" />
                <span className="sr-only">{t("navigation.search")}</span>
                <input
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("navigation.searchPlaceholder")}
                  value={search}
                />
                <kbd>⌘ K</kbd>
              </label>
            ) : (
              <div className="topbar-context">
                <span className="section-kicker">
                  {t("navigation.controlPlane")}
                </span>
              </div>
            )}
            <details className="user-menu">
              <summary
                aria-label={t("navigation.userMenu")}
                className="operator-avatar"
                title={session.data?.email}
              >
                {initials(session.data?.email ?? "Operator")}
              </summary>
              <div className="user-menu-popover">
                <div className="user-menu-identity">
                  <span>{t("navigation.signedInAs")}</span>
                  <strong>
                    <BidiText kind="identifier">
                      {session.data?.email ?? t("navigation.operator")}
                    </BidiText>
                  </strong>
                </div>
                <div className="user-menu-section">
                  <span>{t("navigation.language")}</span>
                  {(["en", "zh-CN"] as const).map((language) => (
                    <button
                      aria-pressed={i18n.resolvedLanguage === language}
                      key={language}
                      onClick={() => void i18n.changeLanguage(language)}
                      type="button"
                    >
                      {language === "en"
                        ? t("navigation.english")
                        : t("navigation.chinese")}
                      {i18n.resolvedLanguage === language ? (
                        <Check aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                </div>
                <button
                  className="user-menu-logout"
                  disabled={logout.isPending}
                  onClick={() => logout.mutate()}
                  type="button"
                >
                  <LogOut aria-hidden="true" />
                  {t("navigation.signOut")}
                </button>
              </div>
            </details>
          </header>
          <main className="app-content" data-active-path={activeLeaf?.href}>
            {children}
          </main>
        </div>
        {composeOpen && activeMailboxId && canCompose ? (
          <Suspense fallback={null}>
            <ComposePanel intent={composeIntent} mailboxId={activeMailboxId} />
          </Suspense>
        ) : null}
      </div>
    </AuthenticatedShellContext.Provider>
  );
}
