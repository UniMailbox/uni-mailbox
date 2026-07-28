import { handleHttpRequest } from "./entrypoints/http";
import { handleInboundEmail } from "./entrypoints/inbound-email";
import { handleQueueBatch } from "./entrypoints/queue";
import { handleScheduledTask } from "./entrypoints/scheduled";
import type { UniMailboxQueueJob, Env } from "./platform/config";

export default {
  fetch: handleHttpRequest,
  email: handleInboundEmail,
  scheduled: handleScheduledTask,
  queue: handleQueueBatch,
} satisfies ExportedHandler<Env, UniMailboxQueueJob>;
