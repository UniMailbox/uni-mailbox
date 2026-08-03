import DOMPurify from "dompurify";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import {
  Archive,
  ArrowLeft,
  Download,
  Reply,
  Star,
  Trash2,
} from "lucide-react";
import { useUiStore } from "../../lib/ui-store";
import { ErrorState, LoadingState } from "../../components/Status";
import { BidiText } from "../../components/BidiText";
import type { RuntimeLocale } from "../../i18n";
import { formatDateTime, formatKibibytes } from "../../i18n/format";
import {
  attachmentDownloadMutationOptions,
  messageAttachmentsQueryOptions,
  messageMoveMutationOptions,
  messageQueryOptions,
} from "./api";

export function MessagePage({ messageId }: { messageId: string }) {
  const { t, i18n } = useTranslation("mail");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openComposer = useUiStore((state) => state.setComposeOpen);
  const selectMailbox = useUiStore((state) => state.setSelectedMailboxId);
  const timeZone = useUiStore((state) => state.timeZone);
  const message = useQuery(messageQueryOptions(messageId));
  const attachments = useQuery(messageAttachmentsQueryOptions(messageId));
  const move = useMutation(messageMoveMutationOptions(queryClient));
  const download = useMutation({
    ...attachmentDownloadMutationOptions(),
    onSuccess: (response, attachment) => {
      const objectUrl = URL.createObjectURL(response.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = attachment.filename || t("message.attachmentFallback");
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    },
  });
  if (message.isLoading) return <LoadingState label={t("message.loading")} />;
  if (message.error || !message.data)
    return <ErrorState error={message.error} />;
  const safeHtml = DOMPurify.sanitize(message.data.html_body || "", {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      "script",
      "style",
      "form",
      "input",
      "button",
      "object",
      "embed",
    ],
  });
  const timestamp = message.data.received_at ?? message.data.sent_at;
  const date = timestamp ? new Date(timestamp) : null;
  const formattedTimestamp =
    date && !Number.isNaN(date.getTime())
      ? formatDateTime(date, i18n.resolvedLanguage as RuntimeLocale, timeZone)
      : t("message.unavailableDate");
  return (
    <section className="message-page">
      <header className="message-topbar">
        <Link
          aria-label={t("message.back")}
          className="icon-button"
          to={`/inbox/${message.data.mailboxId}`}
        >
          <ArrowLeft aria-hidden="true" className="directional-icon" />
        </Link>
        <div className="message-actions">
          <button
            className="icon-button"
            aria-label={t("message.archive")}
            onClick={() =>
              move.mutate(
                {
                  messageId,
                  mailboxId: message.data.mailboxId,
                  folder: "archive",
                },
                {
                  onSuccess: () =>
                    navigate({
                      to: `/archive/${message.data.mailboxId}` as "/inbox",
                    }),
                },
              )
            }
          >
            <Archive />
          </button>
          <button
            className="icon-button"
            aria-label={t("message.trash")}
            onClick={() =>
              move.mutate(
                {
                  messageId,
                  mailboxId: message.data.mailboxId,
                  folder: "trash",
                },
                {
                  onSuccess: () =>
                    navigate({
                      to: `/trash/${message.data.mailboxId}` as "/inbox",
                    }),
                },
              )
            }
          >
            <Trash2 />
          </button>
          <button className="icon-button" aria-label={t("message.star")}>
            <Star />
          </button>
          <button
            className="button secondary"
            onClick={() => {
              selectMailbox(message.data.mailboxId);
              openComposer(true, { parentMessageId: message.data.id });
              void navigate({
                to: `/inbox/${message.data.mailboxId}` as "/inbox",
              });
            }}
          >
            <Reply aria-hidden="true" className="directional-icon" />{" "}
            {t("message.reply")}
          </button>
        </div>
      </header>
      <article className="message-sheet">
        <div className="section-kicker">
          <Trans
            components={{ id: <BidiText kind="identifier" /> }}
            i18nKey="message.identifier"
            ns="mail"
            values={{ id: message.data.id.slice(0, 8) }}
          />
        </div>
        <h1>
          <BidiText>{message.data.subject || t("messages.noSubject")}</BidiText>
        </h1>
        <dl className="message-envelope">
          <div>
            <dt>{t("message.from")}</dt>
            <dd>
              <BidiText>
                {message.data.from_name || message.data.from_address}
              </BidiText>
              <small>
                <BidiText kind="identifier">
                  {message.data.from_address}
                </BidiText>
              </small>
            </dd>
          </div>
          <div>
            <dt>{t("message.to")}</dt>
            <dd>
              <BidiText kind="identifier">
                {message.data.recipients
                  .filter((item) => item.type === "to")
                  .map((item) => item.address)
                  .join(", ")}
              </BidiText>
            </dd>
          </div>
          <div>
            <dt>{t("message.timestamp")}</dt>
            <dd data-testid="message-timestamp">{formattedTimestamp}</dd>
          </div>
        </dl>
        {safeHtml ? (
          <iframe
            className="message-frame"
            sandbox=""
            srcDoc={`<!doctype html><html dir="auto"><meta name="color-scheme" content="light"><style>body{font:15px/1.65 system-ui,sans-serif;color:#202521;margin:0;padding:8px}img{max-width:100%;height:auto}a{color:#155c4b}</style>${safeHtml}</html>`}
            title={t("message.contentTitle")}
          />
        ) : (
          <pre className="message-text">{message.data.text_body}</pre>
        )}
        {attachments.data?.length ? (
          <section className="attachments">
            <h2>{t("message.attachments")}</h2>
            {attachments.data.map((attachment) => (
              <button
                className="attachment-row"
                key={attachment.id}
                onClick={() => download.mutate(attachment)}
                type="button"
              >
                <Download />
                <span>
                  <strong>
                    <BidiText kind="identifier">{attachment.filename}</BidiText>
                  </strong>
                  <small>
                    {t("message.attachmentMeta", {
                      mimeType: attachment.mime_type,
                      size: formatKibibytes(
                        attachment.size_bytes,
                        i18n.resolvedLanguage as RuntimeLocale,
                      ),
                    })}
                  </small>
                </span>
              </button>
            ))}
          </section>
        ) : null}
      </article>
    </section>
  );
}
