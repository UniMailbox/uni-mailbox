import { lazy, Suspense, useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Archive,
  ChevronDown,
  FilePenLine,
  Inbox,
  LogOut,
  Mail,
  Menu,
  PenLine,
  Search,
  Send,
  Settings,
  Shield,
  Star,
  Trash2,
} from "lucide-react";
import { canOpenAdminConsole } from "@unimailbox/contracts";
import { apiRequest } from "../../lib/api";
import { Link, navigate } from "../../lib/navigation";
import { endSession, useSession } from "../../lib/session";
import { useUiStore } from "../../lib/ui-store";
import { ErrorState, LoadingState } from "../../components/Status";

const ComposePanel = lazy(() =>
  import("./ComposePanel").then((module) => ({
    default: module.ComposePanel,
  })),
);

interface Mailbox {
  id: string;
  address: string;
  display_name: string;
  unread_count?: number;
}

interface MessageSummary {
  id: string;
  from_address: string;
  from_name?: string;
  subject: string;
  status: string;
  created_at: string;
  received_at?: string;
  sent_at?: string;
  is_read: number;
  is_starred: number;
}

interface MessagePage {
  items: MessageSummary[];
  nextCursor: string | null;
}

const folders = [
  ["inbox", "Inbox", Inbox],
  ["sent", "Sent", Send],
  ["drafts", "Drafts", FilePenLine],
  ["starred", "Starred", Star],
  ["archive", "Archive", Archive],
  ["trash", "Trash", Trash2],
] as const;

function initials(value: string): string {
  return value
    .split(/[\s@._-]+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function relativeDate(value: string): string {
  const date = new Date(
    value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"),
  );
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function MailWorkspace({
  folder,
  routeMailboxId,
}: {
  folder: string;
  routeMailboxId?: string;
}) {
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
  const mailboxes = useQuery({
    queryKey: ["mailboxes"],
    queryFn: () => apiRequest<Mailbox[]>("/mailboxes"),
  });
  // `RequireSession` has already resolved this query before the workspace
  // mounts, so this reads from cache rather than issuing a second request.
  const session = useSession();
  const adminConsoleAvailable = canOpenAdminConsole(
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
    queryKey: ["drafts"],
    queryFn: () => apiRequest<MessageSummary[]>("/drafts"),
    enabled: folder === "drafts",
  });
  const messages = useInfiniteQuery({
    queryKey: ["messages", activeMailboxId, folder],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const actualFolder = folder === "starred" ? "inbox" : folder;
      const params = new URLSearchParams({
        folder: actualFolder,
        limit: "50",
      });
      if (folder === "starred") params.set("starred", "true");
      if (pageParam) params.set("cursor", pageParam);
      return apiRequest<MessagePage>(
        `/mailboxes/${activeMailboxId}/messages?${params}`,
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(activeMailboxId) && folder !== "drafts",
  });
  const star = useMutation({
    mutationFn: (input: { id: string; value: boolean }) =>
      apiRequest(`/messages/${input.id}/star`, {
        method: "PATCH",
        body: JSON.stringify({ isStarred: input.value }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages"] }),
  });
  const logout = useMutation({
    mutationFn: () => apiRequest("/auth/logout", { method: "POST" }),
    // `onSettled`, not `onSuccess`: if the logout call itself fails we still
    // want the local session gone rather than a half-signed-out tab.
    onSettled: () => {
      endSession(queryClient);
      navigate("/login");
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
  const EmptyIcon = activeFolder[2];

  return (
    <div className="mail-app">
      <aside className={`mail-sidebar ${sidebarOpen ? "open" : ""}`}>
        <header>
          <Link className="wordmark compact" to="/inbox">
            <span>CM</span> UniMailbox
          </Link>
          <button
            aria-label="Close navigation"
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
          <PenLine /> Compose
        </button>
        <nav aria-label="Mail folders">
          <div className="nav-label">Workspace</div>
          {folders.map(([id, label, Icon]) => {
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
                <span>{label}</span>
                {id === "inbox" && activeMailbox?.unread_count ? (
                  <strong>{activeMailbox.unread_count}</strong>
                ) : null}
              </Link>
            );
          })}
          <div className="nav-label admin-label">Control plane</div>
          <Link to="/settings/mailboxes">
            <Settings /> <span>Settings</span>
          </Link>
          {/* Hidden rather than disabled: a member has no console permissions
              at all, so the entry point would only ever lead to a denial. */}
          {adminConsoleAvailable ? (
            <Link to="/admin/users">
              <Shield /> <span>Administration</span>
            </Link>
          ) : null}
        </nav>
        <footer>
          <span className="system-pulse" />
          <div>
            <strong>Systems nominal</strong>
            <small>D1 · Storage · Queue online</small>
          </div>
        </footer>
      </aside>
      <main className="mail-main">
        <header className="mail-topbar">
          <button
            aria-label="Open navigation"
            className="icon-button mobile-menu"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu />
          </button>
          <label className="search-field">
            <Search />
            <span className="sr-only">Search mail</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search loaded mail"
              value={search}
            />
            <kbd>⌘ K</kbd>
          </label>
          <button
            aria-label="Sign out"
            className="icon-button"
            onClick={() => logout.mutate()}
          >
            <LogOut />
          </button>
          <div className="operator-avatar">OP</div>
        </header>
        <section className="mail-content">
          <header className="folder-header">
            <div>
              <p className="section-kicker">
                {activeMailbox?.address ?? "Mailbox"}
              </p>
              <h1>{activeFolder[1]}</h1>
            </div>
            <label className="mailbox-select">
              <Mail />
              <select
                aria-label="Active mailbox"
                onChange={(event) => {
                  setSelectedMailboxId(event.target.value);
                  if (!["drafts", "starred"].includes(folder)) {
                    navigate(`/${folder}/${event.target.value}`);
                  }
                }}
                value={activeMailboxId ?? ""}
              >
                {(mailboxes.data ?? []).map((mailbox) => (
                  <option key={mailbox.id} value={mailbox.id}>
                    {mailbox.address}
                  </option>
                ))}
              </select>
              <ChevronDown />
            </label>
          </header>
          {mailboxes.isLoading || messages.isLoading || drafts.isLoading ? (
            <LoadingState label="Loading messages" />
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
              <h2>No messages here</h2>
              <p>
                This folder is clear. New activity will appear automatically.
              </p>
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
                      message.is_starred ? "Remove star" : "Star message"
                    }
                    className={`star-button ${message.is_starred ? "active" : ""}`}
                    onClick={() =>
                      star.mutate({
                        id: message.id,
                        value: !message.is_starred,
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
                        (message as MessageSummary & { mailbox_id?: string })
                          .mailbox_id ??
                          activeMailboxId ??
                          "",
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
                        {message.from_name || message.from_address}
                      </strong>
                      <small>{message.from_address}</small>
                    </div>
                    <div className="message-preview">
                      <strong>{message.subject || "(No subject)"}</strong>
                      <span>{message.status}</span>
                    </div>
                    <time>
                      {relativeDate(
                        message.received_at ??
                          message.sent_at ??
                          message.created_at,
                      )}
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
                    ? "Loading…"
                    : "Load older messages"}
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
