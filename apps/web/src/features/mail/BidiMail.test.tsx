import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { createTestI18n } from "../../i18n/test-instance";
import { MailWorkspace } from "./MailWorkspace";
import { MessagePage } from "./MessagePage";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to: _to,
    ...props
  }: React.PropsWithChildren<{ to: string }>) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock("../../lib/session", () => ({
  endSession: vi.fn(),
  useSession: () => ({ data: { permissions: [] } }),
}));

const mailboxId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";

function response(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    headers: { "content-type": "application/json" },
  });
}

function renderMail(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <I18nextProvider i18n={createTestI18n("ar-XB")}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </I18nextProvider>,
  );
}

describe("pseudo-RTL mail identifiers", () => {
  it("keeps mailbox address options LTR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (input === "/api/v1/mailboxes")
          return Promise.resolve(
            response([
              {
                id: mailboxId,
                address: "ops@example.com",
                display_name: "Operations",
                status: "active",
                domain_id: "33333333-3333-4333-8333-333333333333",
                role: "owner",
                unread_count: 12345,
              },
            ]),
          );
        return Promise.resolve(response({ items: [], nextCursor: null }));
      }),
    );
    renderMail(<MailWorkspace folder="inbox" routeMailboxId={mailboxId} />);

    expect(
      await screen.findByRole("option", { name: "ops@example.com" }),
    ).toHaveAttribute("dir", "ltr");
  });

  it("isolates the message ID inside the translated pseudo-RTL identifier", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (input === `/api/v1/messages/${messageId}`)
          return Promise.resolve(
            response({
              id: messageId,
              thread_id: null,
              mailboxMessageId: "44444444-4444-4444-8444-444444444444",
              mailboxId,
              from_address: "sender@example.net",
              from_name: "Sender",
              subject: "RTL subject",
              html_body: "<p>Body</p>",
              text_body: "Body",
              message_id_header: null,
              in_reply_to_header: null,
              references_header: "",
              status: "received",
              created_at: "2026-07-31T10:00:00.000Z",
              updated_at: "2026-07-31T10:00:00.000Z",
              sent_at: null,
              received_at: "2026-07-31T10:00:00.000Z",
              recipients: [{ type: "to", address: "ops@example.com" }],
            }),
          );
        return Promise.resolve(response([]));
      }),
    );
    const { container } = renderMail(<MessagePage messageId={messageId} />);

    await screen.findByText("RTL subject");
    const identifier = container.querySelector(".section-kicker bdi");
    expect(identifier).toHaveAttribute("dir", "ltr");
    expect(identifier).toHaveTextContent(messageId.slice(0, 8));
  });
});
