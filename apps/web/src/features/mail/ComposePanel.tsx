import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, Link2, Paperclip, Send, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  attachmentEndpoints,
  draftEndpoints,
  messageEndpoints,
  type EndpointRequest,
  type EndpointResponse,
} from "@unimailbox/contracts";
import { draftsDb } from "../../lib/drafts-db";
import { apiClient, ApiClientError } from "../../lib/api/index";
import { apiErrorToken } from "../../i18n/errors";
import { type ComposeIntent, useUiStore } from "../../lib/ui-store";
import {
  draftQueryOptions,
  mailKeys,
  messageQueryOptions,
} from "./api";

interface ComposeForm {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
}

type DraftDetail = EndpointResponse<typeof draftEndpoints.get>;
type ParentMessage = EndpointResponse<typeof messageEndpoints.get>;
type MessageInput = EndpointRequest<typeof messageEndpoints.send>["body"];

function addresses(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\s]+/u)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

// Debounce window for persisting the in-flight composer to IndexedDB. Keeping
// it short reduces typing lag while still absorbing keystroke bursts and
// Tiptap `onUpdate` events without re-writing on every input.
const LOCAL_DRAFT_DEBOUNCE_MS = 400;

function InlineMutationError({ error }: { error: unknown }) {
  const { t } = useTranslation(["errors"]);
  const token = apiErrorToken(error);
  return (
    <strong className="inline-error" role="alert">
      {String(t(token.key, token.values))}
    </strong>
  );
}

export function ComposePanel({
  mailboxId,
  intent,
}: {
  mailboxId: string;
  intent: ComposeIntent | null;
}) {
  const { t, i18n } = useTranslation("mail");
  const close = useUiStore((state) => state.setComposeOpen);
  const client = useQueryClient();
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [serverDraftId, setServerDraftId] = useState(intent?.draftId);
  const [draftVersion, setDraftVersion] = useState<string>();
  const hydratedSource = useRef<string>();
  const restoredLocal = useRef(false);
  const workingId = useMemo(() => crypto.randomUUID(), []);
  const form = useForm<ComposeForm>({
    defaultValues: { to: "", cc: "", bcc: "", subject: "" },
  });
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: t("compose.editorPlaceholder") }),
    ],
    content: "",
    onUpdate: () => setEditorRevision((current) => current + 1),
  });
  const watched = form.watch();
  const draft = useQuery({
    ...draftQueryOptions(intent?.draftId ?? "00000000-0000-4000-8000-000000000000"),
    enabled: Boolean(intent?.draftId),
  });
  const parent = useQuery({
    ...messageQueryOptions(
      intent?.parentMessageId ?? "00000000-0000-4000-8000-000000000000",
    ),
    enabled: Boolean(intent?.parentMessageId),
  });

  // Tiptap's placeholder plugin reads its option while decorating the existing
  // editor state. Updating that option and dispatching a metadata-only
  // transaction refreshes the decoration without reconstructing the editor or
  // changing its document/selection.
  useEffect(() => {
    if (!editor) return;
    const placeholder = editor.extensionManager.extensions.find(
      (extension) => extension.name === "placeholder",
    ) as { options: { placeholder: string } } | undefined;
    if (!placeholder) return;
    placeholder.options.placeholder = t("compose.editorPlaceholder");
    editor.view.dispatch(
      editor.state.tr.setMeta("unimailbox-placeholder", i18n.language),
    );
  }, [editor, i18n.language, t]);

  useEffect(() => {
    if (!editor || !draft.data || hydratedSource.current === draft.data.id)
      return;
    const recipientValue = (type: "to" | "cc" | "bcc") =>
      draft.data.recipients
        .filter((recipient) => recipient.type === type)
        .map((recipient) => recipient.address)
        .join(", ");
    form.reset({
      to: recipientValue("to"),
      cc: recipientValue("cc"),
      bcc: recipientValue("bcc"),
      subject: draft.data.subject,
    });
    editor.commands.setContent(draft.data.html_body || draft.data.text_body);
    setAttachmentIds(draft.data.attachments.map((attachment) => attachment.id));
    setServerDraftId(draft.data.id);
    setDraftVersion(draft.data.updated_at);
    hydratedSource.current = draft.data.id;
  }, [draft.data, editor, form]);

  useEffect(() => {
    if (!editor || !parent.data || hydratedSource.current === parent.data.id)
      return;
    const subject = /^re:/iu.test(parent.data.subject)
      ? parent.data.subject
      : `Re: ${parent.data.subject}`;
    const quoted = parent.data.html_body
      ? DOMPurify.sanitize(parent.data.html_body)
      : `<pre>${parent.data.text_body}</pre>`;
    form.reset({
      to: parent.data.from_address,
      cc: "",
      bcc: "",
      subject,
    });
    editor.commands.setContent(
      `<p></p><blockquote data-parent-message="${parent.data.id}">${quoted}</blockquote>`,
    );
    hydratedSource.current = parent.data.id;
  }, [editor, form, parent.data]);

  useEffect(() => {
    if (
      !editor ||
      intent?.draftId ||
      intent?.parentMessageId ||
      restoredLocal.current
    )
      return;
    restoredLocal.current = true;
    void draftsDb.workingDrafts
      .where("mailboxId")
      .equals(mailboxId)
      .sortBy("updatedAt")
      .then((drafts) => {
        const local = drafts.at(-1);
        if (!local) return;
        form.reset({
          to: local.to.join(", "),
          cc: local.cc.join(", "),
          bcc: local.bcc.join(", "),
          subject: local.subject,
        });
        editor.commands.setContent(local.html || local.text);
        setAttachmentIds(
          local.attachments
            .filter((attachment) => attachment.uploadState === "ready")
            .map((attachment) => attachment.attachmentId),
        );
        setServerDraftId(local.serverDraftId);
      });
  }, [editor, form, intent, mailboxId]);

  // Hydration order matters: an explicit server draft or reply context wins
  // first; only when both are absent do we restore a previously typed
  // working draft from IndexedDB so users never lose their in-flight text.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      void draftsDb.workingDrafts.put({
        id: workingId,
        mailboxId,
        serverDraftId,
        to: addresses(watched.to),
        cc: addresses(watched.cc),
        bcc: addresses(watched.bcc),
        subject: watched.subject,
        html: editor?.getHTML() ?? "",
        text: editor?.getText() ?? "",
        includeSignature: true,
        attachments: attachmentIds.map((attachmentId) => ({
          attachmentId,
          filename: "attachment",
          size: 0,
          uploadState: "ready",
        })),
        updatedAt: Date.now(),
      });
    }, LOCAL_DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [
    attachmentIds,
    editor,
    editorRevision,
    mailboxId,
    serverDraftId,
    watched,
    workingId,
  ]);

  function messageInput(values: ComposeForm): MessageInput {
    return {
      mailboxId,
      to: addresses(values.to),
      cc: addresses(values.cc),
      bcc: addresses(values.bcc),
      subject: values.subject,
      html: editor?.getHTML() ?? "",
      text: editor?.getText() ?? "",
      parentMessageId: intent?.parentMessageId,
      includeSignature: true,
      attachmentIds,
    };
  }

  async function persistDraft(values: ComposeForm): Promise<DraftDetail> {
    const result = serverDraftId
      ? await apiClient.request(draftEndpoints.update, {
          params: { draftId: serverDraftId },
          headers: { "if-match": `"${draftVersion ?? ""}"` },
          body: messageInput(values),
        })
      : await apiClient.request(draftEndpoints.create, {
          body: messageInput(values),
        });
    setServerDraftId(result.id);
    setDraftVersion(result.updated_at);
    await draftsDb.workingDrafts.update(workingId, {
      serverDraftId: result.id,
    });
    return result;
  }

  const save = useMutation({
    mutationFn: persistDraft,
    onSuccess: () => client.invalidateQueries({ queryKey: mailKeys.drafts() }),
  });

  const send = useMutation({
    mutationFn: async (values: ComposeForm) => {
      if (serverDraftId) {
        const saved = await persistDraft(values);
        return apiClient.request(draftEndpoints.send, {
          params: { draftId: saved.id },
          headers: {
            "idempotency-key": crypto.randomUUID(),
            "if-match": `"${saved.updated_at}"`,
          },
        });
      }
      return apiClient.request(messageEndpoints.send, {
        headers: { "idempotency-key": crypto.randomUUID() },
        body: messageInput(values),
      });
    },
    onSuccess: async () => {
      await draftsDb.workingDrafts.delete(workingId);
      await client.invalidateQueries({ queryKey: mailKeys.messagesRoot() });
      await client.invalidateQueries({ queryKey: mailKeys.drafts() });
      close(false);
    },
  });

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const upload = await apiClient.request(attachmentEndpoints.createUpload, {
        body: {
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          disposition: "attachment",
        },
      });
      const response = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.uploadHeaders,
        body: file,
      });
      if (!response.ok)
        throw new ApiClientError("ATTACHMENT_UPLOAD_UNAVAILABLE", response.status);
      await apiClient.request(attachmentEndpoints.completeUpload, {
        params: { attachmentId: upload.attachmentId },
      });
      setAttachmentIds((current) => [...current, upload.attachmentId]);
    } finally {
      setUploading(false);
    }
  }

  return (
    <aside className="compose-panel" aria-label={t("compose.panelLabel")}>
      <header>
        <div>
          <span className="live-dot" />
          <strong>{t("compose.newTransmission")}</strong>
        </div>
        <button
          aria-label={t("compose.close")}
          className="icon-button"
          onClick={() => close(false)}
          type="button"
        >
          <X />
        </button>
      </header>
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => send.mutate(values))}
      >
        <label className="compose-line">
          <span>{t("compose.toShort")}</span>
          <input
            {...form.register("to", {
              required: {
                value: true,
                message: t("compose.validation.recipientRequired"),
              },
            })}
            aria-label={t("compose.to")}
            placeholder="recipient@example.com"
          />
        </label>
        <details className="recipient-details">
          <summary>{t("compose.addRecipients")}</summary>
          <label className="compose-line">
            <span>{t("compose.cc")}</span>
            <input {...form.register("cc")} aria-label={t("compose.cc")} />
          </label>
          <label className="compose-line">
            <span>{t("compose.bcc")}</span>
            <input {...form.register("bcc")} aria-label={t("compose.bcc")} />
          </label>
        </details>
        <label className="compose-line subject-line">
          <span>{t("compose.subjectShort")}</span>
          <input
            {...form.register("subject")}
            aria-label={t("compose.subject")}
            placeholder={t("compose.subjectPlaceholder")}
          />
        </label>
        <div className="editor-toolbar" aria-label={t("compose.formatting")}>
          <button
            aria-label={t("compose.bold")}
            className={editor?.isActive("bold") ? "active" : ""}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            type="button"
          >
            <Bold />
          </button>
          <button
            aria-label={t("compose.italic")}
            className={editor?.isActive("italic") ? "active" : ""}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            type="button"
          >
            <Italic />
          </button>
          <span />
          <label className="toolbar-upload">
            <Paperclip />
            <span className="sr-only">{t("compose.attach")}</span>
            <input
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFile(file);
              }}
              type="file"
            />
          </label>
          <button aria-label={t("compose.insertLink")} disabled type="button">
            <Link2 />
          </button>
        </div>
        <EditorContent className="message-editor" editor={editor} />
        <footer>
          <div className="compose-meta">
            <span>{t("compose.autosaved")}</span>
            {attachmentIds.length ? (
              <strong>{t("compose.attachmentCount", { count: attachmentIds.length })}</strong>
            ) : null}
            {uploading ? <strong>{t("compose.uploading")}</strong> : null}
            {send.error ? <InlineMutationError error={send.error} /> : null}
            {save.error ? <InlineMutationError error={save.error} /> : null}
            {form.formState.errors.to?.message ? (
              <strong className="inline-error" role="alert">
                {form.formState.errors.to.message}
              </strong>
            ) : null}
            {save.isSuccess ? <strong>{t("compose.saved")}</strong> : null}
          </div>
          <div className="compose-actions">
            <button
              className="button secondary"
              disabled={save.isPending || send.isPending}
              onClick={form.handleSubmit((values) => save.mutate(values))}
              type="button"
            >
              {save.isPending ? t("compose.saving") : t("compose.saveDraft")}
            </button>
            <button
              className="button primary"
              disabled={send.isPending || save.isPending}
            >
              <span>{send.isPending ? t("compose.sending") : t("compose.send")}</span>
              <Send />
            </button>
          </div>
        </footer>
      </form>
    </aside>
  );
}
