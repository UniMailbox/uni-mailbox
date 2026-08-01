import { describe, expect, it } from "vitest";
import {
  attachmentEndpoints,
  draftEndpoints,
  mailboxEndpoints,
  messageEndpoints,
  type EndpointRequest,
} from "../src/api";

const mailboxId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const attachmentId = "44444444-4444-4444-8444-444444444444";

describe("current Worker mail endpoint contracts", () => {
  it("declares every mailbox and member route with UUID params", () => {
    expect(mailboxEndpoints.list).toMatchObject({
      method: "GET",
      path: "/mailboxes",
    });
    expect(mailboxEndpoints.create).toMatchObject({
      method: "POST",
      path: "/mailboxes",
    });
    expect(mailboxEndpoints.get).toMatchObject({
      method: "GET",
      path: "/mailboxes/:mailboxId",
    });
    expect(mailboxEndpoints.listMembers).toMatchObject({
      method: "GET",
      path: "/mailboxes/:mailboxId/members",
    });
    expect(mailboxEndpoints.addMember).toMatchObject({
      method: "POST",
      path: "/mailboxes/:mailboxId/members",
    });
    expect(mailboxEndpoints.updateMember).toMatchObject({
      method: "PATCH",
      path: "/mailboxes/:mailboxId/members/:userId",
    });
    expect(mailboxEndpoints.removeMember).toMatchObject({
      method: "DELETE",
      path: "/mailboxes/:mailboxId/members/:userId",
      mediaType: "empty",
    });
    expect(
      mailboxEndpoints.get.request?.params?.parse({
        mailboxId: `  ${mailboxId}  `,
      }),
    ).toEqual({ mailboxId });
  });

  it("preserves mailbox and member snake-case response fields", () => {
    expect(
      mailboxEndpoints.list.responses[200].parse([
        {
          id: mailboxId,
          address: "ops@example.com",
          display_name: "Operations",
          status: "active",
          domain_id: userId,
          role: "owner",
        },
      ]),
    ).toEqual([
      {
        id: mailboxId,
        address: "ops@example.com",
        display_name: "Operations",
        status: "active",
        domain_id: userId,
        role: "owner",
      },
    ]);
    expect(
      mailboxEndpoints.listMembers.responses[200].parse([
        {
          user_id: userId,
          email: "member@example.com",
          display_name: "Member",
          role: "sender",
          created_at: "2026-07-31 09:00:00",
        },
      ])[0],
    ).toMatchObject({
      user_id: userId,
      display_name: "Member",
      created_at: "2026-07-31 09:00:00",
    });
  });

  it("declares current message listing, detail, state, move, and send routes", () => {
    expect(messageEndpoints.list).toMatchObject({
      method: "GET",
      path: "/mailboxes/:mailboxId/messages",
    });
    expect(messageEndpoints.get).toMatchObject({
      method: "GET",
      path: "/messages/:messageId",
    });
    expect(messageEndpoints.star).toMatchObject({
      method: "PATCH",
      path: "/messages/:messageId/star",
    });
    expect(messageEndpoints.move).toMatchObject({
      method: "PATCH",
      path: "/messages/:messageId/folder",
    });
    expect(messageEndpoints.send).toMatchObject({
      method: "POST",
      path: "/messages/send",
    });
    expect(
      messageEndpoints.list.request?.query?.parse({
        folder: "inbox",
        limit: 50,
        starred: true,
      }),
    ).toEqual({ folder: "inbox", limit: 50, starred: true });
    expect(
      messageEndpoints.send.request?.headers?.parse({
        "idempotency-key": "request-1",
      }),
    ).toEqual({ "idempotency-key": "request-1" });
  });

  it("parses actual message detail and list bodies without renaming wire fields", () => {
    const listed = messageEndpoints.list.responses[200].parse({
      items: [
        {
          id: messageId,
          from_address: "sender@example.net",
          from_name: "Sender",
          subject: "Status",
          status: "received",
          created_at: "2026-07-31 09:00:00",
          sent_at: null,
          received_at: "2026-07-31 09:00:00",
          is_read: 0,
          is_starred: 1,
        },
      ],
      nextCursor: null,
    });
    expect(listed.items[0]).toMatchObject({
      from_address: "sender@example.net",
      is_starred: 1,
    });
    expect(
      messageEndpoints.get.responses[200].parse({
        id: messageId,
        thread_id: messageId,
        mailboxMessageId: attachmentId,
        mailboxId,
        from_address: "sender@example.net",
        from_name: "Sender",
        subject: "Status",
        html_body: "<p>hello</p>",
        text_body: "hello",
        message_id_header: null,
        in_reply_to_header: null,
        references_header: "",
        status: "received",
        created_at: "2026-07-31 09:00:00",
        updated_at: "2026-07-31 09:00:00",
        sent_at: null,
        received_at: "2026-07-31 09:00:00",
        recipients: [
          {
            type: "to",
            address: "ops@example.com",
            display_name: "Operations",
          },
        ],
      }),
    ).toMatchObject({ html_body: "<p>hello</p>", text_body: "hello" });
  });

  it("declares list, detail, create, update, and send drafts with ETag headers", () => {
    expect(draftEndpoints.list).toMatchObject({
      method: "GET",
      path: "/drafts",
    });
    expect(draftEndpoints.get).toMatchObject({
      method: "GET",
      path: "/drafts/:draftId",
    });
    expect(draftEndpoints.create).toMatchObject({
      method: "POST",
      path: "/drafts",
    });
    expect(draftEndpoints.update).toMatchObject({
      method: "PUT",
      path: "/drafts/:draftId",
    });
    expect(draftEndpoints.send).toMatchObject({
      method: "POST",
      path: "/drafts/:draftId/send",
    });
    expect(
      draftEndpoints.update.request?.headers?.parse({
        "if-match": '"2026-07-31T00:00:00.000Z#version"',
      }),
    ).toEqual({ "if-match": '"2026-07-31T00:00:00.000Z#version"' });
    expect(
      draftEndpoints.send.request?.headers?.parse({
        "if-match": '"version"',
        "idempotency-key": "request-1",
      }),
    ).toEqual({ "if-match": '"version"', "idempotency-key": "request-1" });
  });

  it("declares Worker draft-not-found and reply-parent-not-found errors", () => {
    expect(draftEndpoints.get.errors).toContain("DRAFT_NOT_FOUND");
    expect(draftEndpoints.update.errors).toContain("DRAFT_NOT_FOUND");
    expect(draftEndpoints.send.errors).toContain("DRAFT_NOT_FOUND");
    expect(messageEndpoints.send.errors).toContain("PARENT_MESSAGE_NOT_FOUND");
  });

  it("preserves draft and attachment wire fields", () => {
    const detail = draftEndpoints.get.responses[200].parse({
      id: messageId,
      mailboxId,
      subject: "Draft",
      html_body: "<p>draft</p>",
      text_body: "draft",
      updated_at: "2026-07-31T00:00:00.000Z#version",
      recipients: [
        { type: "to", address: "ops@example.com", display_name: "Operations" },
      ],
      attachments: [
        {
          id: attachmentId,
          filename: "runbook.txt",
          mime_type: "text/plain",
          size_bytes: 12,
          disposition: "attachment",
          content_id: null,
        },
      ],
    });
    expect(detail).toMatchObject({
      html_body: "<p>draft</p>",
      updated_at: "2026-07-31T00:00:00.000Z#version",
    });
    expect(
      messageEndpoints.listAttachments.responses[200].parse([
        {
          id: attachmentId,
          filename: "runbook.txt",
          mime_type: "text/plain",
          size_bytes: 12,
          disposition: "attachment",
          content_id: null,
        },
      ])[0],
    ).toMatchObject({ mime_type: "text/plain", size_bytes: 12 });
  });

  it("declares upload completion and a metadata-preserving binary download", () => {
    expect(attachmentEndpoints.createUpload).toMatchObject({
      method: "POST",
      path: "/attachments/uploads",
    });
    expect(attachmentEndpoints.completeUpload).toMatchObject({
      method: "POST",
      path: "/attachments/uploads/:attachmentId/complete",
    });
    expect(attachmentEndpoints.uploadContent).toMatchObject({
      method: "PUT",
      path: "/attachments/uploads/:attachmentId/content",
      mediaType: "empty",
      transport: "worker-signed-url",
    });
    expect(attachmentEndpoints.uploadContent.responses[204]).toBeNull();
    expect(attachmentEndpoints.download).toMatchObject({
      method: "GET",
      path: "/attachments/:attachmentId/download",
      mediaType: "binary",
    });
    expect(
      attachmentEndpoints.download.responses[200].parse({
        blob: new Blob(["contents"]),
        contentDisposition: "attachment; filename*=UTF-8''runbook.txt",
      }),
    ).toMatchObject({
      contentDisposition: "attachment; filename*=UTF-8''runbook.txt",
    });
  });

  it("keeps endpoint request types runtime-validated", () => {
    const send: EndpointRequest<typeof messageEndpoints.send> = {
      headers: { "idempotency-key": "request-1" },
      body: {
        mailboxId,
        to: ["OPERATOR@example.com"],
        cc: [],
        bcc: [],
        subject: "",
        html: "",
        text: "",
        includeSignature: true,
        attachmentIds: [],
      },
    };
    expect(messageEndpoints.send.request?.body?.parse(send.body)).toMatchObject(
      { to: ["operator@example.com"] },
    );
  });
});
