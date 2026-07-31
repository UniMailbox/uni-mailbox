import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, Link2, Paperclip, Send, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { draftsDb } from "../../lib/drafts-db";
import { apiRequest, jsonBody } from "../../lib/api";
import { type ComposeIntent, useUiStore } from "../../lib/ui-store";

interface ComposeForm {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
}

interface DraftDetail {
  id: string;
  mailboxId: string;
  subject: string;
  html_body: string;
  text_body: string;
  updated_at: string;
  recipients: Array<{ type: "to" | "cc" | "bcc"; address: string }>;
  attachments: Array<{ id: string }>;
}

interface ParentMessage {
  id: string;
  from_address: string;
  subject: string;
  html_body: string;
  text_body: string;
}

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

export function ComposePanel({
  mailboxId,
  intent,
}: {
  mailboxId: string;
  intent: ComposeIntent | null;
}) {
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
      Placeholder.configure({ placeholder: "Write your message…" }),
    ],
    content: "",
    onUpdate: () => setEditorRevision((current) => current + 1),
  });
  const watched = form.watch();
  const draft = useQuery({
    queryKey: ["draft", intent?.draftId],
    queryFn: () => apiRequest<DraftDetail>(`/drafts/${intent?.draftId}`),
    enabled: Boolean(intent?.draftId),
  });
  const parent = useQuery({
    queryKey: ["message", intent?.parentMessageId],
    queryFn: () =>
      apiRequest<ParentMessage>(`/messages/${intent?.parentMessageId}`),
    enabled: Boolean(intent?.parentMessageId),
  });

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

  function messageInput(values: ComposeForm) {
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
      ? await apiRequest<DraftDetail>(`/drafts/${serverDraftId}`, {
          method: "PUT",
          headers: { "if-match": `"${draftVersion ?? ""}"` },
          body: jsonBody(messageInput(values)),
        })
      : await apiRequest<DraftDetail>("/drafts", {
          method: "POST",
          body: jsonBody(messageInput(values)),
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
    onSuccess: () => client.invalidateQueries({ queryKey: ["drafts"] }),
  });

  const send = useMutation({
    mutationFn: async (values: ComposeForm) => {
      if (serverDraftId) {
        const saved = await persistDraft(values);
        return apiRequest<{ messageId: string }>(`/drafts/${saved.id}/send`, {
          method: "POST",
          headers: {
            "idempotency-key": crypto.randomUUID(),
            "if-match": `"${saved.updated_at}"`,
          },
        });
      }
      return apiRequest<{ messageId: string }>("/messages/send", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: jsonBody(messageInput(values)),
      });
    },
    onSuccess: async () => {
      await draftsDb.workingDrafts.delete(workingId);
      await client.invalidateQueries({ queryKey: ["messages"] });
      close(false);
    },
  });

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const upload = await apiRequest<{
        attachmentId: string;
        uploadUrl: string;
        uploadHeaders: Record<string, string>;
      }>("/attachments/uploads", {
        method: "POST",
        body: jsonBody({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          disposition: "attachment",
        }),
      });
      const response = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.uploadHeaders,
        body: file,
      });
      if (!response.ok) throw new Error("Attachment upload failed");
      await apiRequest(`/attachments/uploads/${upload.attachmentId}/complete`, {
        method: "POST",
      });
      setAttachmentIds((current) => [...current, upload.attachmentId]);
    } finally {
      setUploading(false);
    }
  }

  return (
    <aside className="compose-panel" aria-label="Compose message">
      <header>
        <div>
          <span className="live-dot" />
          <strong>New transmission</strong>
        </div>
        <button
          aria-label="Close composer"
          className="icon-button"
          onClick={() => close(false)}
          type="button"
        >
          <X />
        </button>
      </header>
      <form onSubmit={form.handleSubmit((values) => send.mutate(values))}>
        <label className="compose-line">
          <span>TO</span>
          <input
            {...form.register("to", { required: true })}
            aria-label="To"
            placeholder="recipient@example.com"
          />
        </label>
        <details className="recipient-details">
          <summary>Add CC / BCC</summary>
          <label className="compose-line">
            <span>CC</span>
            <input {...form.register("cc")} aria-label="CC" />
          </label>
          <label className="compose-line">
            <span>BCC</span>
            <input {...form.register("bcc")} aria-label="BCC" />
          </label>
        </details>
        <label className="compose-line subject-line">
          <span>SUBJ</span>
          <input
            {...form.register("subject")}
            aria-label="Subject"
            placeholder="Subject"
          />
        </label>
        <div className="editor-toolbar" aria-label="Message formatting">
          <button
            aria-label="Bold"
            className={editor?.isActive("bold") ? "active" : ""}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            type="button"
          >
            <Bold />
          </button>
          <button
            aria-label="Italic"
            className={editor?.isActive("italic") ? "active" : ""}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            type="button"
          >
            <Italic />
          </button>
          <span />
          <label className="toolbar-upload">
            <Paperclip />
            <span className="sr-only">Attach file</span>
            <input
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFile(file);
              }}
              type="file"
            />
          </label>
          <button aria-label="Insert link" disabled type="button">
            <Link2 />
          </button>
        </div>
        <EditorContent className="message-editor" editor={editor} />
        <footer>
          <div className="compose-meta">
            <span>Autosaved locally</span>
            {attachmentIds.length ? (
              <strong>{attachmentIds.length} attachment(s) ready</strong>
            ) : null}
            {uploading ? <strong>Uploading…</strong> : null}
            {send.error ? (
              <strong className="inline-error">{send.error.message}</strong>
            ) : null}
            {save.error ? (
              <strong className="inline-error">{save.error.message}</strong>
            ) : null}
            {save.isSuccess ? <strong>Saved to server</strong> : null}
          </div>
          <div className="compose-actions">
            <button
              className="button secondary"
              disabled={save.isPending || send.isPending}
              onClick={form.handleSubmit((values) => save.mutate(values))}
              type="button"
            >
              {save.isPending ? "Saving…" : "Save draft"}
            </button>
            <button
              className="button primary"
              disabled={send.isPending || save.isPending}
            >
              <span>{send.isPending ? "Queueing…" : "Send message"}</span>
              <Send />
            </button>
          </div>
        </footer>
      </form>
    </aside>
  );
}
