import { lazy, Suspense, useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Check,
  ChevronDown,
  FilePenLine,
  Inbox,
  LogOut,
  Mail,
  Menu,
  Paperclip,
  PenLine,
  Search,
  Send,
  Settings,
  Shield,
  Star,
  Trash2,
} from "lucide-react";
import { adminConsoleEntryResource } from "@unimailbox/contracts";
import { endSession, useSession } from "../../lib/session";
import { logoutMutationOptions } from "../auth/api";
import { useUiStore } from "../../lib/ui-store";
import { ErrorState, LoadingState } from "../../components/Status";
import { BidiText } from "../../components/BidiText";
import type { RuntimeLocale } from "../../i18n";
import { formatNumber, formatRelativeDate } from "../../i18n/format";
import {
  draftsQueryOptions,
  mailboxesQueryOptions,
  messageStarMutationOptions,
  messagesInfiniteQueryOptions,
} from "./api";

const ComposePanel = lazy(() =>
  import("./ComposePanel").then((module) => ({
    default: module.ComposePanel,
  })),
);

const folders = [
  ["inbox", Inbox],
  ["sent", Send],
  ["drafts", FilePenLine],
  ["starred", Star],
  ["archive", Archive],
  ["trash", Trash2],
] as const;

function initials(value: string): string {
  return value
    .split(/[\s@._-]+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function MailWorkspace({
  folder,
  routeMailboxId,
}: {
  folder: string;
  routeMailboxId?: string;
}) {
  const { t, i18n } = useTranslation("mail");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const selectedMailboxId = useUiStore((state) => state.selectedMailboxId);
  const setSelectedMailboxId = useUiStore(
    (state) => state.setSelectedMailboxId,
  );
  const composeOpen = useUiStore((state) => state.composeOpen);
  const composeIntent = useUiStore((state) => state.composeIntent);
  const setComposeOpen = useUiStore((state) => state.setComposeOpen);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const timeZone = useUiStore((state) => state.timeZone);
  const mailboxes = useQuery(mailboxesQueryOptions());
  // The authenticated Router parent has already resolved this query before the workspace
  // mounts, so this reads from cache rather than issuing a second request.
  const session = useSession();
  const adminConsoleEntry = adminConsoleEntryResource(
    session.data?.permissions ?? [],
  );
  const activeMailboxId =
    routeMailboxId ?? selectedMailboxId ?? mailboxes.data?.[0]?.id ?? null;

  useEffect(() => {
    if (activeMailboxId && activeMailboxId !== selectedMailboxId) {
      setSelectedMailboxId(activeMailboxId);
    }
  }, [activeMailboxId, selectedMailboxId, setSelectedMailboxId]);

  const drafts = useQuery({
    ...draftsQueryOptions(),
    enabled: folder === "drafts",
  });
  const messages = useInfiniteQuery({
    ...messagesInfiniteQueryOptions({
      mailboxId: activeMailboxId ?? "00000000-0000-4000-8000-000000000000",
      folder: folder as
        | "inbox"
        | "sent"
        | "drafts"
        | "starred"
        | "archive"
        | "trash",
      search,
    }),
    enabled: Boolean(activeMailboxId) && folder !== "drafts",
  });
  const star = useMutation(messageStarMutationOptions(queryClient));
  const logout = useMutation({
    ...logoutMutationOptions(queryClient),
    // `onSettled`, not `onSuccess`: if the logout call itself fails we still
    // want the local session gone rather than a half-signed-out tab.
    onSettled: () => {
      endSession(queryClient);
      void navigate({ to: "/login", replace: true });
    },
  });

  const allItems =
    folder === "drafts"
      ? (drafts.data ?? [])
      : (messages.data?.pages.flatMap((page) => page.items) ?? []);
  const normalizedSearch = search.trim().toLowerCase();
  const items = normalizedSearch
    ? allItems.filter((message) =>
        [message.subject, message.from_name ?? "", message.from_address].some(
          (value) => value.toLowerCase().includes(normalizedSearch),
        ),
      )
    : allItems;
  const activeMailbox = mailboxes.data?.find(
    (mailbox) => mailbox.id === activeMailboxId,
  );
  const activeFolder = folders.find(([id]) => id === folder) ?? folders[0];
  const EmptyIcon = activeFolder[1];
  const locale = i18n.resolvedLanguage as RuntimeLocale;

  return (
    <div className="mail-app">
      <aside className={`mail-sidebar ${sidebarOpen ? "open" : ""}`}>
        <header>
          <Link className="wordmark compact" to="/inbox">
            <span>CM</span> UniMailbox
          </Link>
          <button
            aria-label={t("navigation.close")}
            className="sidebar-close"
            onClick={() => setSidebarOpen(false)}
          >
            ×
          </button>
        </header>
        <button
          className="compose-button"
          disabled={!activeMailboxId}
          onClick={() => setComposeOpen(true)}
        >
          <PenLine /> {t("compose.panelLabel")}
        </button>
        <nav aria-label={t("navigation.folders")}>
          <div className="nav-label">{t("navigation.workspace")}</div>
          {folders.map(([id, Icon]) => {
            const path =
              id === "drafts" || id === "starred"
                ? `/${id}`
                : `/${id}/${activeMailboxId ?? ""}`;
            return (
              <Link
                aria-current={folder === id ? "page" : undefined}
                className={folder === id ? "active" : ""}
                key={id}
                to={path}
              >
                <Icon />
                <span>{t(`folders.${id}`)}</span>
                {id === "inbox" && activeMailbox?.unread_count ? (
                  <strong>
                    {formatNumber(activeMailbox.unread_count, locale)}
                  </strong>
                ) : null}
              </Link>
            );
          })}
          <div className="nav-label admin-label">
            {t("navigation.controlPlane")}
          </div>
          <Link to="/settings/mailboxes">
            <Settings /> <span>{t("navigation.settings")}</span>
          </Link>
          {adminConsoleEntry ? (
            <Link to={`/admin/${adminConsoleEntry}`}>
              {adminConsoleEntry === "attachments" ? (
                <Paperclip />
              ) : (
                <Shield />
              )}
              <span>
                {t(
                  adminConsoleEntry === "attachments"
                    ? "navigation.attachments"
                    : "navigation.administration",
                )}
              </span>
            </Link>
          ) : null}
        </nav>
        <footer>
          <span className="system-pulse" />
          <div>
            <strong>{t("system.nominal")}</strong>
            <small>{t("system.online")}</small>
          </div>
        </footer>
      </aside>
      <main className="mail-main">
        <header className="mail-topbar">
          <button
            aria-label={t("navigation.open")}
            className="icon-button mobile-menu"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu />
          </button>
          <label className="search-field">
            <Search />
            <span className="sr-only">{t("navigation.search")}</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("navigation.searchPlaceholder")}
              value={search}
            />
            <kbd>⌘ K</kbd>
          </label>
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
        <section className="mail-content">
          <header className="folder-header">
            <div>
              <p className="section-kicker">
                <BidiText kind="identifier">
                  {activeMailbox?.address ?? t("messages.mailbox")}
                </BidiText>
              </p>
              <h1>{t(`folders.${activeFolder[0]}`)}</h1>
            </div>
            <label className="mailbox-select">
              <Mail />
              <select
                aria-label={t("navigation.activeMailbox")}
                onChange={(event) => {
                  setSelectedMailboxId(event.target.value);
                  if (!["drafts", "starred"].includes(folder)) {
                    void navigate({
                      to: `/${folder}/${event.target.value}` as "/inbox",
                    });
                  }
                }}
                value={activeMailboxId ?? ""}
              >
                {(mailboxes.data ?? []).map((mailbox) => (
                  <option dir="ltr" key={mailbox.id} value={mailbox.id}>
                    {mailbox.address}
                  </option>
                ))}
              </select>
              <ChevronDown />
            </label>
          </header>
          {mailboxes.isLoading || messages.isLoading || drafts.isLoading ? (
            <LoadingState label={t("messages.loading")} />
          ) : mailboxes.error || messages.error || drafts.error ? (
            <ErrorState
              error={mailboxes.error ?? messages.error ?? drafts.error}
              retry={() => {
                void mailboxes.refetch();
                void messages.refetch();
                void drafts.refetch();
              }}
            />
          ) : items.length === 0 ? (
            <div className="empty-mail">
              <span>
                <EmptyIcon />
              </span>
              <h2>{t("messages.emptyTitle")}</h2>
              <p>{t("messages.emptyBody")}</p>
            </div>
          ) : (
            <div className="message-list" role="list">
              {items.map((message) => (
                <article
                  className={message.is_read ? "" : "unread"}
                  key={message.id}
                  role="listitem"
                >
                  <button
                    aria-label={
                      message.is_starred
                        ? t("messages.unstar")
                        : t("messages.star")
                    }
                    className={`star-button ${message.is_starred ? "active" : ""}`}
                    onClick={() =>
                      star.mutate({
                        messageId: message.id,
                        isStarred: !message.is_starred,
                      })
                    }
                  >
                    <Star />
                  </button>
                  <div className="sender-avatar">
                    {initials(message.from_name || message.from_address)}
                  </div>
                  <Link
                    className="message-link"
                    onClick={(event) => {
                      if (folder !== "drafts") return;
                      event.preventDefault();
                      setSelectedMailboxId(
                        message.mailbox_id ?? activeMailboxId ?? "",
                      );
                      setComposeOpen(true, { draftId: message.id });
                    }}
                    to={
                      folder === "drafts"
                        ? `/drafts/${message.id}`
                        : `/messages/${message.id}`
                    }
                  >
                    <div className="message-sender">
                      <strong>
                        <BidiText>
                          {message.from_name || message.from_address}
                        </BidiText>
                      </strong>
                      <small>
                        <BidiText kind="identifier">
                          {message.from_address}
                        </BidiText>
                      </small>
                    </div>
                    <div className="message-preview">
                      <strong>
                        <BidiText>
                          {message.subject || t("messages.noSubject")}
                        </BidiText>
                      </strong>
                      <span>
                        {message.status &&
                        ["draft", "queued", "sent", "received"].includes(
                          message.status,
                        )
                          ? t(`messages.status.${message.status}`)
                          : t("messages.unknownStatus")}
                      </span>
                    </div>
                    <time>
                      {formatRelativeDate(
                        message.received_at ??
                          message.sent_at ??
                          message.created_at,
                        locale,
                        timeZone,
                      ) ?? t("message.unavailableDate")}
                    </time>
                  </Link>
                </article>
              ))}
              {messages.hasNextPage ? (
                <button
                  className="button secondary load-more"
                  disabled={messages.isFetchingNextPage}
                  onClick={() => void messages.fetchNextPage()}
                  type="button"
                >
                  {messages.isFetchingNextPage
                    ? t("messages.loadingMore")
                    : t("messages.loadMore")}
                </button>
              ) : null}
            </div>
          )}
        </section>
      </main>
      {composeOpen && activeMailboxId ? (
        <Suspense fallback={null}>
          <ComposePanel intent={composeIntent} mailboxId={activeMailboxId} />
        </Suspense>
      ) : null}
    </div>
  );
}
