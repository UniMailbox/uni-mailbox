import { useEffect } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, Mail, Star } from "lucide-react";
import { useAuthenticatedShell } from "../../components/AuthenticatedShell";
import { BidiText } from "../../components/BidiText";
import { ErrorState, LoadingState } from "../../components/Status";
import { WORKSPACE_FOLDER_NAVIGATION } from "../../lib/app-navigation";
import type { MailFolder } from "./api";
import { useUiStore } from "../../lib/ui-store";
import type { RuntimeLocale } from "../../i18n";
import { formatRelativeDate } from "../../i18n/format";
import {
  draftsQueryOptions,
  mailboxesQueryOptions,
  messageStarMutationOptions,
  messagesInfiniteQueryOptions,
} from "./api";

function folderNavigation(folder: MailFolder) {
  return (
    WORKSPACE_FOLDER_NAVIGATION.find((item) => item.id === folder) ??
    WORKSPACE_FOLDER_NAVIGATION[0]
  );
}

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
  folder: MailFolder;
  routeMailboxId?: string;
}) {
  const { t, i18n } = useTranslation("mail");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const shell = useAuthenticatedShell();
  const search = shell?.search ?? "";
  const selectedMailboxId = useUiStore((state) => state.selectedMailboxId);
  const setSelectedMailboxId = useUiStore(
    (state) => state.setSelectedMailboxId,
  );
  const setComposeOpen = useUiStore((state) => state.setComposeOpen);
  const timeZone = useUiStore((state) => state.timeZone);
  const mailboxes = useQuery(mailboxesQueryOptions());
  const activeMailboxId =
    shell?.activeMailboxId ??
    routeMailboxId ??
    selectedMailboxId ??
    mailboxes.data?.[0]?.id ??
    null;

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
      folder,
      search,
    }),
    enabled: Boolean(activeMailboxId) && folder !== "drafts",
  });
  const star = useMutation(messageStarMutationOptions(queryClient));

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
  const activeFolder = folderNavigation(folder);
  const EmptyIcon = activeFolder.icon;
  const locale = i18n.resolvedLanguage as RuntimeLocale;

  return (
    <section className="mail-content">
      <header className="folder-header">
        <div>
          <p className="section-kicker">
            <BidiText kind="identifier">
              {activeMailbox?.address ?? t("messages.mailbox")}
            </BidiText>
          </p>
          <h1>{t(activeFolder.labelKey)}</h1>
        </div>
        <label className="mailbox-select">
          <Mail aria-hidden="true" />
          <select
            aria-label={t("navigation.activeMailbox")}
            onChange={(event) => {
              setSelectedMailboxId(event.target.value);
              if (folder !== "drafts" && folder !== "starred") {
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
          <ChevronDown aria-hidden="true" />
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
            <EmptyIcon aria-hidden="true" />
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
                  message.is_starred ? t("messages.unstar") : t("messages.star")
                }
                className={`star-button ${message.is_starred ? "active" : ""}`}
                onClick={() =>
                  star.mutate({
                    messageId: message.id,
                    isStarred: !message.is_starred,
                  })
                }
                type="button"
              >
                <Star aria-hidden="true" />
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
  );
}
