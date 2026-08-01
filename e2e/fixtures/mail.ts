export const composeAttachmentId = "33333333-3333-4333-8333-333333333333";

export const composeAttachmentFixture = {
  id: composeAttachmentId,
  filename: "runbook.txt",
  mime_type: "text/plain",
  size_bytes: 14,
  disposition: "attachment" as const,
  content_id: null,
};

export function composeDraftFixture({
  id,
  mailboxId,
  updatedAt,
}: {
  id: string;
  mailboxId: string;
  updatedAt: string;
}) {
  return {
    id,
    mailboxId,
    subject: "Incident update",
    html_body: "<p>Systems nominal</p>",
    text_body: "Systems nominal",
    updated_at: updatedAt,
    recipients: [{ type: "to" as const, address: "team@example.com" }],
    attachments: [composeAttachmentFixture],
  };
}

export const replyMessageFixture = {
  id: "44444444-4444-4444-8444-444444444444",
  thread_id: null,
  mailboxMessageId: "55555555-5555-4555-8555-555555555555",
  mailboxId: "11111111-1111-4111-8111-111111111111",
  from_address: "sender@example.net",
  from_name: "Sender",
  subject: "Change window",
  html_body: "<p>Proceed at 02:00 UTC.</p>",
  text_body: "Proceed at 02:00 UTC.",
  message_id_header: null,
  in_reply_to_header: null,
  references_header: "",
  status: "received",
  created_at: "2026-07-27T09:00:00.000Z",
  updated_at: "2026-07-27T09:00:00.000Z",
  sent_at: null,
  received_at: "2026-07-27T09:00:00.000Z",
  recipients: [{ type: "to" as const, address: "ops@example.com" }],
};
