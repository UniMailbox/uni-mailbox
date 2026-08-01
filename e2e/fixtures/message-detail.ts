export const mailboxId = "11111111-1111-4111-8111-111111111111";
export const messageId = "55555555-5555-4555-8555-555555555555";

export const messageDetailFixture = {
  id: messageId,
  thread_id: null,
  mailboxMessageId: "66666666-6666-4666-8666-666666666666",
  mailboxId,
  from_address: "sender@example.net",
  from_name: "Sender",
  subject: "Archive me",
  html_body: "<p>Message</p>",
  text_body: "Message",
  message_id_header: "<archive-me@example.net>",
  in_reply_to_header: null,
  references_header: "",
  status: "received",
  created_at: "2026-07-27 09:00:00",
  updated_at: "2026-07-27 09:00:00",
  sent_at: null,
  received_at: "2026-07-27 09:00:00",
  recipients: [],
};
