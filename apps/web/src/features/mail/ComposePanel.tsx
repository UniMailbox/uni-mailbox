import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useStore } from "@tanstack/react-form";
import {
  Bold,
  CalendarClock,
  Italic,
  Link2,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  attachmentEndpoints,
  draftEndpoints,
  messageEndpoints,
  type EndpointRequest,
  type EndpointResponse,
} from "@unimailbox/contracts";
import { draftsDb } from "../../lib/drafts-db";
import { apiClient } from "../../lib/api/index";
import {
  FieldError,
  FormRoot,
  useAppFieldContext,
  useAppForm,
} from "../../lib/form/app-form";
import { apiErrorToken } from "../../i18n/errors";
import { localeMetadata, type RuntimeLocale } from "../../i18n";
import { type ComposeIntent, useUiStore } from "../../lib/ui-store";
import {
  draftCancelScheduleMutationOptions,
  draftQueryOptions,
  draftScheduleMutationOptions,
  mailKeys,
  messageQueryOptions,
} from "./api";

interface ComposeFormValues {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
}

type DraftDetail = EndpointResponse<typeof draftEndpoints.get>;
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

function localDateTimeValue(value?: string | null): string {
  const date = value ? new Date(value) : new Date(Date.now() + 120_000);
  const candidate = Number.isNaN(date.getTime())
    ? new Date(Date.now() + 120_000)
    : date;
  const pad = (part: number) => part.toString().padStart(2, "0");
  return `${candidate.getFullYear()}-${pad(candidate.getMonth() + 1)}-${pad(candidate.getDate())}T${pad(candidate.getHours())}:${pad(candidate.getMinutes())}`;
}

function toScheduledIso(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const ComposeFormSchema = {
  "~standard": {
    version: 1,
    vendor: "unimailbox",
    validate(value: ComposeFormValues) {
      const result = messageEndpoints.send.request.body.safeParse({
        mailboxId: "00000000-0000-4000-8000-000000000000",
        to: addresses(value.to),
        cc: addresses(value.cc),
        bcc: addresses(value.bcc),
        subject: value.subject,
        html: "",
        text: "",
        includeSignature: true,
        attachmentIds: [],
      });
      if (result.success) return { value: result.data };
      return {
        issues: result.error.issues.map((issue) => ({
          ...issue,
          message: issue.message,
          path: issue.path?.slice(0, 1),
        })),
      };
    },
  },
};

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

function ComposeFieldError({
  label,
  recipient,
}: {
  label: string;
  recipient?: boolean;
}) {
  const field = useAppFieldContext<unknown>();
  const { t } = useTranslation("mail");
  const error = field.state.meta.errors.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "code" in candidate &&
      candidate.code === "too_small",
  );

  if (recipient && error) {
    return (
      <strong className="inline-error" role="alert">
        {t("compose.validation.recipientRequired")}
      </strong>
    );
  }

  return <FieldError label={label} />;
}

export function ComposePanel({
  mailboxId,
  intent,
}: {
  mailboxId: string;
  intent: ComposeIntent | null;
}) {
  const { t, i18n } = useTranslation("mail");
  const editorDirection =
    localeMetadata[i18n.resolvedLanguage as RuntimeLocale]?.direction ?? "ltr";
  const close = useUiStore((state) => state.setComposeOpen);
  const client = useQueryClient();
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [serverDraftId, setServerDraftId] = useState(intent?.draftId);
  const [draftVersion, setDraftVersion] = useState<string>();
  const [scheduledAtInput, setScheduledAtInput] = useState(() =>
    localDateTimeValue(),
  );
  const [localRecoveryComplete, setLocalRecoveryComplete] = useState(() =>
    Boolean(intent?.draftId || intent?.parentMessageId),
  );
  const hydratedSource = useRef<string>();
  const restoredLocal = useRef(false);
  const [workingId, setWorkingId] = useState<string>(() => crypto.randomUUID());
  const form = useAppForm({
    defaultValues: { to: "", cc: "", bcc: "", subject: "" },
    validators: { onSubmit: ComposeFormSchema as never },
    onSubmit: async ({ value }) => {
      await submitMessage(value);
    },
  });
  const formValues = useStore(form.store, (state) => state.values);
  const sendPending = useRef(false);
  const scheduleMutation = useMutation(draftScheduleMutationOptions(client));
  const cancelScheduleMutation = useMutation(
    draftCancelScheduleMutationOptions(client),
  );

  function hydrateForm(values: ComposeFormValues) {
    form.reset(values);
    form.setFieldValue("to", values.to);
    form.setFieldValue("cc", values.cc);
    form.setFieldValue("bcc", values.bcc);
    form.setFieldValue("subject", values.subject);
  }
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: t("compose.editorPlaceholder") }),
    ],
    content: "",
    onUpdate: () => setEditorRevision((current) => current + 1),
  });
  const draft = useQuery({
    ...draftQueryOptions(
      intent?.draftId ?? "00000000-0000-4000-8000-000000000000",
    ),
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
    editor.view.dom.setAttribute("dir", editorDirection);
    editor.view.dispatch(
      editor.state.tr.setMeta("unimailbox-placeholder", i18n.language),
    );
  }, [editor, editorDirection, i18n.language, t]);

  useEffect(() => {
    if (!editor || !draft.data || hydratedSource.current === draft.data.id)
      return;
    const recipientValue = (type: "to" | "cc" | "bcc") =>
      draft.data.recipients
        .filter((recipient) => recipient.type === type)
        .map((recipient) => recipient.address)
        .join(", ");
    hydrateForm({
      to: recipientValue("to"),
      cc: recipientValue("cc"),
      bcc: recipientValue("bcc"),
      subject: draft.data.subject,
    });
    editor.commands.setContent(draft.data.html_body || draft.data.text_body);
    setAttachmentIds(draft.data.attachments.map((attachment) => attachment.id));
    setServerDraftId(draft.data.id);
    setDraftVersion(draft.data.updated_at);
    setScheduledAtInput(localDateTimeValue(draft.data.scheduled_at));
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
    hydrateForm({
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
        if (local) {
          hydrateForm({
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
          setWorkingId(local.id);
        }
      })
      .catch(() => undefined)
      .finally(() => setLocalRecoveryComplete(true));
  }, [editor, form, intent, mailboxId]);

  // Hydration order matters: an explicit server draft or reply context wins
  // first; only when both are absent do we restore a previously typed
  // working draft from IndexedDB so users never lose their in-flight text.
  useEffect(() => {
    if (!localRecoveryComplete) return;
    const handle = window.setTimeout(() => {
      void draftsDb.workingDrafts.put({
        id: workingId,
        mailboxId,
        serverDraftId,
        to: addresses(formValues.to),
        cc: addresses(formValues.cc),
        bcc: addresses(formValues.bcc),
        subject: formValues.subject,
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
    localRecoveryComplete,
    serverDraftId,
    formValues,
    workingId,
  ]);

  function messageInput(values: ComposeFormValues): MessageInput {
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

  async function persistDraft(values: ComposeFormValues): Promise<DraftDetail> {
    const input = draftEndpoints.create.request.body.parse(
      messageInput(values),
    );
    // The TanStack form store can publish hydrated fields before React commits
    // the paired draft-version state update. Keep the already-validated query
    // response as the source for that narrow interval so an immediate send
    // never downgrades an existing draft's optimistic-concurrency header.
    const currentDraftVersion = draftVersion ?? draft.data?.updated_at;
    const result = serverDraftId
      ? await apiClient.request(draftEndpoints.update, {
          params: { draftId: serverDraftId },
          headers: { "if-match": `"${currentDraftVersion ?? ""}"` },
          body: input,
        })
      : await apiClient.request(draftEndpoints.create, {
          body: input,
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
    mutationFn: async (values: ComposeFormValues) => {
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
        body: messageEndpoints.send.request.body.parse(messageInput(values)),
      });
    },
    onSuccess: async () => {
      await draftsDb.workingDrafts.delete(workingId);
      await client.invalidateQueries({ queryKey: mailKeys.messagesRoot() });
      await client.invalidateQueries({ queryKey: mailKeys.drafts() });
      close(false);
    },
  });
  const isBusy =
    scheduleMutation.isPending ||
    cancelScheduleMutation.isPending ||
    send.isPending ||
    save.isPending;

  async function scheduleDraft() {
    if (isBusy) return;
    const scheduledAt = toScheduledIso(scheduledAtInput);
    if (!scheduledAt) return;
    const saved = await persistDraft(formValues);
    const result = await scheduleMutation.mutateAsync({
      draftId: saved.id,
      mailboxId,
      ifMatch: `"${saved.updated_at}"`,
      idempotencyKey: crypto.randomUUID(),
      scheduledAt,
    });
    setDraftVersion(result.updatedAt);
    setScheduledAtInput(localDateTimeValue(result.scheduledAt));
  }

  async function cancelDraftSchedule() {
    if (isBusy || !serverDraftId || !draft.data?.scheduled_at) return;
    const currentVersion = draftVersion ?? draft.data?.updated_at;
    if (!currentVersion) return;
    const result = await cancelScheduleMutation.mutateAsync({
      draftId: serverDraftId,
      mailboxId,
      ifMatch: `"${currentVersion}"`,
      idempotencyKey: crypto.randomUUID(),
    });
    setDraftVersion(result.updatedAt);
    if (result.cancelled) {
      setScheduledAtInput("");
    }
  }

  async function saveDraft() {
    if (isBusy) return;
    await save.mutateAsync(formValues);
  }

  async function submitMessage(values: ComposeFormValues) {
    if (sendPending.current || isBusy) return;
    sendPending.current = true;
    try {
      await send.mutateAsync(values);
    } finally {
      sendPending.current = false;
    }
  }

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
      await apiClient.request(attachmentEndpoints.uploadContent, {
        url: upload.uploadUrl,
        params: { attachmentId: upload.attachmentId },
        headers: upload.uploadHeaders,
        body: file,
      });
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
      <FormRoot form={form}>
        <form.AppField name="to">
          {(field) => (
            <label className="compose-line">
              <span>{t("compose.toShort")}</span>
              <input
                aria-label={t("compose.to")}
                dir="ltr"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="recipient@example.com"
                value={formValues.to}
              />
              <ComposeFieldError label={t("compose.to")} recipient />
            </label>
          )}
        </form.AppField>
        <details className="recipient-details">
          <summary>{t("compose.addRecipients")}</summary>
          <form.AppField name="cc">
            {(field) => (
              <label className="compose-line">
                <span>{t("compose.cc")}</span>
                <input
                  aria-label={t("compose.cc")}
                  dir="ltr"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  value={formValues.cc}
                />
                <ComposeFieldError label={t("compose.cc")} />
              </label>
            )}
          </form.AppField>
          <form.AppField name="bcc">
            {(field) => (
              <label className="compose-line">
                <span>{t("compose.bcc")}</span>
                <input
                  aria-label={t("compose.bcc")}
                  dir="ltr"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  value={formValues.bcc}
                />
                <ComposeFieldError label={t("compose.bcc")} />
              </label>
            )}
          </form.AppField>
        </details>
        <form.AppField name="subject">
          {(field) => (
            <label className="compose-line subject-line">
              <span>{t("compose.subjectShort")}</span>
              <input
                aria-label={t("compose.subject")}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder={t("compose.subjectPlaceholder")}
                value={formValues.subject}
              />
              <ComposeFieldError label={t("compose.subject")} />
            </label>
          )}
        </form.AppField>
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
        <EditorContent
          className="message-editor"
          dir={editorDirection}
          editor={editor}
        />
        <label className="compose-line schedule-line">
          <span>{t("compose.scheduleAt")}</span>
          <input
            aria-label={t("compose.scheduleAt")}
            disabled={isBusy}
            onChange={(event) => setScheduledAtInput(event.target.value)}
            type="datetime-local"
            value={scheduledAtInput}
          />
        </label>
        <footer>
          <div className="compose-meta">
            <span>{t("compose.autosaved")}</span>
            {attachmentIds.length ? (
              <strong>
                {t("compose.attachmentCount", { count: attachmentIds.length })}
              </strong>
            ) : null}
            {uploading ? <strong>{t("compose.uploading")}</strong> : null}
            {send.error ? <InlineMutationError error={send.error} /> : null}
            {save.error ? <InlineMutationError error={save.error} /> : null}
            {scheduleMutation.error ? (
              <InlineMutationError error={scheduleMutation.error} />
            ) : null}
            {cancelScheduleMutation.error ? (
              <InlineMutationError error={cancelScheduleMutation.error} />
            ) : null}
            {save.isSuccess ? <strong>{t("compose.saved")}</strong> : null}
          </div>
          <div className="compose-actions">
            <button
              className="button secondary"
              disabled={isBusy}
              onClick={() => {
                void saveDraft();
              }}
              type="button"
            >
              {save.isPending ? t("compose.saving") : t("compose.saveDraft")}
            </button>
            <button
              className="button secondary"
              disabled={isBusy || !toScheduledIso(scheduledAtInput)}
              onClick={() => {
                void scheduleDraft();
              }}
              type="button"
            >
              <CalendarClock />
              <span>
                {scheduleMutation.isPending
                  ? t("compose.scheduling")
                  : t("compose.scheduleSend")}
              </span>
            </button>
            <button
              className="button tertiary"
              disabled={
                isBusy ||
                !draft.data?.scheduled_at ||
                cancelScheduleMutation.isPending
              }
              onClick={() => {
                void cancelDraftSchedule();
              }}
              type="button"
            >
              {t("compose.cancelSchedule")}
            </button>
            <button className="button primary" disabled={isBusy}>
              <span>
                {send.isPending ? t("compose.sending") : t("compose.send")}
              </span>
              <Send />
            </button>
          </div>
        </footer>
      </FormRoot>
    </aside>
  );
}
