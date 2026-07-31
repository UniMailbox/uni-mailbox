import DOMPurify from "dompurify";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
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
import {
  attachmentDownloadMutationOptions,
  messageAttachmentsQueryOptions,
  messageMoveMutationOptions,
  messageQueryOptions,
} from "./api";

export function MessagePage({ messageId }: { messageId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openComposer = useUiStore((state) => state.setComposeOpen);
  const selectMailbox = useUiStore((state) => state.setSelectedMailboxId);
  const message = useQuery(messageQueryOptions(messageId));
  const attachments = useQuery(messageAttachmentsQueryOptions(messageId));
  const move = useMutation(messageMoveMutationOptions(queryClient));
  const download = useMutation({
    ...attachmentDownloadMutationOptions(),
    onSuccess: (response, attachment) => {
      const objectUrl = URL.createObjectURL(response.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = attachment.filename || "attachment";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    },
  });
  if (message.isLoading) return <LoadingState label="Opening message" />;
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
  return (
    <main className="message-page">
      <header className="message-topbar">
        <Link className="icon-button" to={`/inbox/${message.data.mailboxId}`}>
          <ArrowLeft aria-label="Back to inbox" />
        </Link>
        <div className="message-actions">
          <button
            className="icon-button"
            aria-label="Archive message"
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
            aria-label="Move message to trash"
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
          <button className="icon-button" aria-label="Star message">
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
            <Reply /> Reply
          </button>
        </div>
      </header>
      <article className="message-sheet">
        <div className="section-kicker">
          Message / {message.data.id.slice(0, 8)}
        </div>
        <h1>{message.data.subject || "(No subject)"}</h1>
        <dl className="message-envelope">
          <div>
            <dt>From</dt>
            <dd>
              {message.data.from_name || message.data.from_address}
              <small>{message.data.from_address}</small>
            </dd>
          </div>
          <div>
            <dt>To</dt>
            <dd>
              {message.data.recipients
                .filter((item) => item.type === "to")
                .map((item) => item.address)
                .join(", ")}
            </dd>
          </div>
          <div>
            <dt>Timestamp</dt>
            <dd>{message.data.received_at ?? message.data.sent_at ?? "—"}</dd>
          </div>
        </dl>
        {safeHtml ? (
          <iframe
            className="message-frame"
            sandbox=""
            srcDoc={`<!doctype html><meta name="color-scheme" content="light"><style>body{font:15px/1.65 system-ui,sans-serif;color:#202521;margin:0;padding:8px}img{max-width:100%;height:auto}a{color:#155c4b}</style>${safeHtml}`}
            title="Message content"
          />
        ) : (
          <pre className="message-text">{message.data.text_body}</pre>
        )}
        {attachments.data?.length ? (
          <section className="attachments">
            <h2>Attachments</h2>
            {attachments.data.map((attachment) => (
              <button
                className="attachment-row"
                key={attachment.id}
                onClick={() => download.mutate(attachment)}
                type="button"
              >
                <Download />
                <span>
                  <strong>{attachment.filename}</strong>
                  <small>
                    {attachment.mime_type} ·{" "}
                    {Math.ceil(attachment.size_bytes / 1024)} KB
                  </small>
                </span>
              </button>
            ))}
          </section>
        ) : null}
      </article>
    </main>
  );
}
