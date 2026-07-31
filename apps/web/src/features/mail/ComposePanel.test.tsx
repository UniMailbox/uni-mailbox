import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestI18n } from "../../i18n/test-instance";
import type { RuntimeLocale } from "../../i18n";
import { ComposePanel } from "./ComposePanel";

const draftStore = vi.hoisted(() => {
  const sortBy = vi.fn(async (): Promise<unknown[]> => []);
  return {
    sortBy,
    where: vi.fn(() => ({ equals: vi.fn(() => ({ sortBy })) })),
    put: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
});

vi.mock("../../lib/drafts-db", () => ({
  draftsDb: { workingDrafts: draftStore },
}));

const mailboxId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const parentId = "33333333-3333-4333-8333-333333333333";
const attachmentId = "44444444-4444-4444-8444-444444444444";

const serverDraft = {
  id: draftId,
  mailboxId,
  subject: "Deployment notes",
  html_body: "<p>Ready for review</p>",
  text_body: "Ready for review",
  updated_at: "2026-07-31T10:00:00.000Z",
  recipients: [
    { type: "to", address: "to@example.com" },
    { type: "cc", address: "cc@example.com" },
    { type: "bcc", address: "bcc@example.com" },
  ],
  attachments: [
    {
      id: attachmentId,
      filename: "notes.txt",
      mime_type: "text/plain",
      size_bytes: 12,
      disposition: "attachment",
      content_id: null,
    },
  ],
};

const parentMessage = {
  id: parentId,
  thread_id: null,
  mailboxMessageId: "55555555-5555-4555-8555-555555555555",
  mailboxId,
  from_address: "sender@example.net",
  from_name: "Sender",
  subject: "Change window",
  html_body: "<p>Proceed at 02:00 UTC.</p>",
  text_body: "Proceed at 02:00 UTC.",
  message_id_header: null,
  in_reply_to_header: null,
  references_header: "",
  status: "received",
  created_at: "2026-07-31T10:00:00.000Z",
  updated_at: "2026-07-31T10:00:00.000Z",
  sent_at: null,
  received_at: "2026-07-31T10:00:00.000Z",
  recipients: [{ type: "to", address: "ops@example.com" }],
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderCompose(
  locale: RuntimeLocale = "en",
  intent: { draftId?: string; parentMessageId?: string } | null = null,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const i18n = createTestI18n(locale);
  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ComposePanel intent={intent} mailboxId={mailboxId} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { ...view, client, i18n };
}

describe("ComposePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    draftStore.sortBy.mockResolvedValue([]);
    draftStore.where.mockClear();
    draftStore.put.mockClear();
    draftStore.update.mockClear();
    draftStore.delete.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders the Chinese composer label when the active locale is zh-CN", () => {
    renderCompose("zh-CN");

    expect(
      screen.getByRole("complementary", { name: "撰写邮件" }),
    ).toBeVisible();
  });

  it("hydrates every server draft field instead of replacing it with a blank working copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        expect(input).toBe(`/api/v1/drafts/${draftId}`);
        return Promise.resolve(response(serverDraft));
      }),
    );
    renderCompose("en", { draftId });

    await waitFor(() =>
      expect(screen.getByLabelText("To")).toHaveValue("to@example.com"),
    );
    expect(screen.getByLabelText("CC")).toHaveValue("cc@example.com");
    expect(screen.getByLabelText("BCC")).toHaveValue("bcc@example.com");
    expect(screen.getByLabelText("Subject")).toHaveValue("Deployment notes");
    expect(document.querySelector(".ProseMirror")).toHaveTextContent(
      "Ready for review",
    );
    expect(screen.getByText("1 attachment ready")).toBeVisible();
    expect(draftStore.where).not.toHaveBeenCalled();
  });

  it("hydrates a reply recipient, subject, quote, and parent context", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init });
        if (input === `/api/v1/messages/${parentId}`)
          return Promise.resolve(response(parentMessage));
        return Promise.resolve(response({ messageId: draftId, status: "queued" }, 201));
      }),
    );
    renderCompose("en", { parentMessageId: parentId });

    await waitFor(() =>
      expect(screen.getByLabelText("To")).toHaveValue("sender@example.net"),
    );
    expect(screen.getByLabelText("Subject")).toHaveValue("Re: Change window");
    expect(document.querySelector(".ProseMirror")).toHaveTextContent(
      "Proceed at 02:00 UTC.",
    );
    expect(draftStore.where).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(draftStore.delete).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      parentMessageId: parentId,
    });
  });

  it("restores the latest local working draft only for a new composer", async () => {
    draftStore.sortBy.mockResolvedValue([
      {
        id: "local-draft",
        mailboxId,
        to: ["local@example.com"],
        cc: [],
        bcc: [],
        subject: "Local recovery",
        html: "<p>Recovered body</p>",
        text: "Recovered body",
        includeSignature: true,
        attachments: [
          {
            attachmentId,
            filename: "notes.txt",
            size: 12,
            uploadState: "ready",
          },
        ],
        updatedAt: 1,
      },
    ]);

    renderCompose();

    await waitFor(() =>
      expect(screen.getByLabelText("To")).toHaveValue("local@example.com"),
    );
    expect(screen.getByLabelText("Subject")).toHaveValue("Local recovery");
    expect(document.querySelector(".ProseMirror")).toHaveTextContent(
      "Recovered body",
    );
  });

  it("deletes the recovered working draft after a successful send", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "99999999-9999-4999-8999-999999999999",
    );
    draftStore.sortBy.mockResolvedValue([
      {
        id: "recovered-working-draft",
        mailboxId,
        to: ["local@example.com"],
        cc: [],
        bcc: [],
        subject: "Recovered draft",
        html: "<p>Recovered body</p>",
        text: "Recovered body",
        includeSignature: true,
        attachments: [],
        updatedAt: 1,
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response({ messageId: draftId, status: "queued" }, 201))),
    );
    renderCompose();

    await screen.findByDisplayValue("Recovered draft");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(draftStore.delete).toHaveBeenCalledWith("recovered-working-draft"),
    );
  });

  it("debounces its local working-draft persistence for 400 milliseconds", async () => {
    vi.useFakeTimers();
    renderCompose();
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "team@example.com" },
    });

    await vi.advanceTimersByTimeAsync(399);
    expect(draftStore.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(draftStore.put).toHaveBeenCalledTimes(1);
  });

  it("keeps typed recipient and subject values while an attachment uploads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (input === "/upload") return Promise.resolve(new Response());
        if (input === "/api/v1/attachments/uploads")
          return Promise.resolve(
            response({
              attachmentId,
              objectKey: "attachments/notes.txt",
              uploadUrl: "https://example.test/upload",
              uploadHeaders: {},
              expiresAt: "2026-07-31T11:00:00.000Z",
              transport: "worker-kv-binding",
            }, 201),
          );
        if (input === "https://example.test/upload")
          return Promise.resolve(new Response());
        return Promise.resolve(response({ attachmentId, status: "uploaded" }));
      }),
    );
    renderCompose();
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "team@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Attachment state" },
    });
    fireEvent.change(screen.getByLabelText("Attach file"), {
      target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] },
    });

    await waitFor(() => expect(screen.getByText("1 attachment ready")).toBeVisible());
    expect(screen.getByLabelText("To")).toHaveValue("team@example.com");
    expect(screen.getByLabelText("Subject")).toHaveValue("Attachment state");
  });

  it("saves an existing draft with its current version before sending it", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ input, init });
        if (
          input === `/api/v1/drafts/${draftId}` &&
          init?.method === "PUT"
        )
          return Promise.resolve(
            response({ ...serverDraft, updated_at: "2026-07-31T10:01:00.000Z" }),
          );
        if (input === `/api/v1/drafts/${draftId}/send`)
          return Promise.resolve(response({ messageId: draftId, status: "queued" }));
        return Promise.resolve(response(serverDraft));
      }),
    );
    const { client } = renderCompose("en", { draftId });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await screen.findByDisplayValue("Deployment notes");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(draftStore.delete).toHaveBeenCalledTimes(1));
    expect(requests.slice(0, 3).map(({ input }) => input)).toEqual([
      `/api/v1/drafts/${draftId}`,
      `/api/v1/drafts/${draftId}`,
      `/api/v1/drafts/${draftId}/send`,
    ]);
    expect(new Headers(requests[1]?.init?.headers).get("if-match")).toBe(
      '"2026-07-31T10:00:00.000Z"',
    );
    expect(new Headers(requests[2]?.init?.headers).get("if-match")).toBe(
      '"2026-07-31T10:01:00.000Z"',
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["mail", "messages"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["mail", "drafts"] });
  });

  it("keeps fields and editor HTML when the language changes", async () => {
    const { i18n } = renderCompose();
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "team@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Locale safety" },
    });
    fireEvent.change(screen.getByLabelText("CC"), {
      target: { value: "cc@example.com" },
    });
    fireEvent.change(screen.getByLabelText("BCC"), {
      target: { value: "bcc@example.com" },
    });
    fireEvent.input(document.querySelector(".ProseMirror")!, {
      target: { innerHTML: "<p>Keep this body</p>" },
    });

    await i18n.changeLanguage("zh-CN");

    expect(screen.getByLabelText("收件人")).toHaveValue("team@example.com");
    expect(screen.getByLabelText("主题")).toHaveValue("Locale safety");
    expect(screen.getByLabelText("抄送")).toHaveValue("cc@example.com");
    expect(screen.getByLabelText("密送")).toHaveValue("bcc@example.com");
    expect(document.querySelector(".ProseMirror")).toHaveTextContent(
      "Keep this body",
    );
  });

  it("refreshes the editor placeholder after a language change without recreating the editor", async () => {
    const { i18n } = renderCompose();
    const editor = document.querySelector(".ProseMirror")!;

    await i18n.changeLanguage("zh-CN");

    expect(document.querySelector(".ProseMirror")).toBe(editor);
    expect(document.querySelector(".ProseMirror p")).toHaveAttribute(
      "data-placeholder",
      "输入邮件内容…",
    );
  });

  it("keeps recipient address inputs LTR in the pseudo-RTL locale", () => {
    renderCompose("ar-XB");

    expect(screen.getByLabelText("[Ţø — ŘŢĻ Ţëšţ]")).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText("[ÇÇ — ŘŢĻ Ţëšţ]")).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText("[βÇÇ — ŘŢĻ Ţëšţ]")).toHaveAttribute("dir", "ltr");
  });

  it("reports an empty recipient with translated validation instead of sending", async () => {
    renderCompose("zh-CN");
    fireEvent.click(screen.getByRole("button", { name: "发送邮件" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "请至少添加一位收件人。",
    );
  });
});
