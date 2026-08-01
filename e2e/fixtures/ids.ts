/**
 * UUIDs and addresses used across e2e flow specs. The same `MAILBOX_ID` is
 * referenced by every test that needs an Operations mailbox, so a test that
 * mutates it would surface in any spec that shares the value. Keep them
 * deterministic — the test recorder asserts on path strings, and a hand-typed
 * uuid in two places drifts sooner than you think.
 */
export const MAILBOX_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_MAILBOX_ID = "11111111-1111-4111-8111-111111111112";

export const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
export const STARRED_MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
export const REPLY_MESSAGE_ID = "66666666-6666-4666-8666-666666666666";
export const ARCHIVE_MESSAGE_ID = "77777777-7777-4777-8777-777777777777";
export const DOWNLOAD_MESSAGE_ID = "88888888-8888-4888-8888-888888888888";

export const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
export const NEW_DRAFT_ID = "22222222-2222-4222-8222-222222222223";

export const ATTACHMENT_ID = "33333333-3333-4333-8333-333333333333";
export const DOWNLOAD_ATTACHMENT_ID = "33333333-3333-4333-8333-333333333334";

export const MEMBER_USER_ID = "99999999-9999-4999-8999-999999999999";
export const ADMIN_ROLE_ID = "00000000-0000-4000-8000-000000000001";
export const MEMBER_ROLE_ID = "00000000-0000-4000-8000-000000000002";

export const OPS_ADDRESS = "ops@example.com";
export const SENDER_ADDRESS = "sender@example.net";
export const TEAM_ADDRESS = "team@example.com";
export const ADMIN_EMAIL = "admin@example.test";
export const MEMBER_EMAIL = "member@example.test";
