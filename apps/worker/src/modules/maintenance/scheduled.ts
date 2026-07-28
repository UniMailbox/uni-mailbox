import type { AppContext } from "../../app-context";
import { OutboundJobService } from "../outbound-mail";

export async function runScheduledTasks(
  context: AppContext,
  scheduledTime: number,
): Promise<void> {
  await context.env.KV.put("health:scheduled:last_run", String(scheduledTime), {
    expirationTtl: 86_400,
  });
  await recoverExpiredOutboundLocks(context);
  await new OutboundJobService(context).dispatchPending();
  const date = new Date(scheduledTime);
  if (date.getUTCMinutes() === 0) {
    await cleanupExpiredUploads(context);
    await aggregateOperationalMetrics(context);
  }
  if (date.getUTCHours() === 3 && date.getUTCMinutes() === 17) {
    await runDailyCleanup(context);
    await cleanupTrashAndMessages(context);
    await cleanupOrphanObjects(context);
  }
  await processMaintenanceJobs(context);
}

async function recoverExpiredOutboundLocks(context: AppContext): Promise<void> {
  await context.env.DB.prepare(
    `UPDATE outbound_jobs
     SET status = 'pending', lock_token = NULL, lock_expires_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE status = 'processing' AND lock_expires_at < ?`,
  )
    .bind(Date.now())
    .run();
}

async function cleanupExpiredUploads(context: AppContext): Promise<void> {
  const uploads = await context.env.DB.prepare(
    `SELECT id, object_key
     FROM attachment_uploads
     WHERE status IN ('pending', 'uploaded') AND expires_at <= CURRENT_TIMESTAMP
     LIMIT 100`,
  ).all<{ id: string; object_key: string }>();
  for (const upload of uploads.results) {
    await context.env.ATTACHMENTS.delete(upload.object_key);
    await context.env.DB.prepare(
      `UPDATE attachment_uploads
       SET status = 'expired'
       WHERE id = ? AND status IN ('pending', 'uploaded')`,
    )
      .bind(upload.id)
      .run();
  }
  context.logger.info("maintenance.uploads.cleaned", {
    count: uploads.results.length,
  });
}

async function runDailyCleanup(context: AppContext): Promise<void> {
  await context.env.DB.batch([
    context.env.DB.prepare(
      `DELETE FROM sessions
       WHERE expires_at <= CURRENT_TIMESTAMP OR revoked_at IS NOT NULL`,
    ),
    context.env.DB.prepare(
      `DELETE FROM idempotency_records WHERE expires_at <= CURRENT_TIMESTAMP`,
    ),
    context.env.DB.prepare(
      `DELETE FROM webhook_events
       WHERE created_at < datetime('now', '-90 days')`,
    ),
    context.env.DB.prepare(
      `DELETE FROM webhook_deliveries
       WHERE updated_at < datetime('now', '-90 days')`,
    ),
  ]);
  context.logger.info("maintenance.daily.completed");
}

async function aggregateOperationalMetrics(context: AppContext): Promise<void> {
  const metrics = await context.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM outbound_jobs WHERE status = 'pending') AS queue_pending,
       (SELECT COUNT(*) FROM outbound_jobs WHERE status = 'failed') AS queue_failed,
       (SELECT COUNT(*) FROM webhook_deliveries WHERE processing_status = 'failed') AS webhook_failed,
       (SELECT COUNT(*) FROM messages WHERE received_at >= datetime('now', '-1 hour')) AS inbound_hour,
       (SELECT COUNT(*) FROM messages WHERE sent_at >= datetime('now', '-1 hour')) AS outbound_hour`,
  ).first<Record<string, number>>();
  context.logger.info("maintenance.metrics.aggregated", metrics ?? {});
}

async function cleanupTrashAndMessages(context: AppContext): Promise<void> {
  await context.env.DB.batch([
    context.env.DB.prepare(
      `DELETE FROM message_user_state
       WHERE deleted_at < datetime('now', '-30 days')`,
    ),
    context.env.DB.prepare(
      `DELETE FROM mailbox_messages
       WHERE folder = 'trash' AND updated_at < datetime('now', '-30 days')`,
    ),
  ]);
  const messages = await context.env.DB.prepare(
    `SELECT m.id, m.raw_object_key
     FROM messages m
     LEFT JOIN mailbox_messages mm ON mm.message_id = m.id
     WHERE mm.id IS NULL
       AND m.created_at < datetime('now', '-30 days')
     LIMIT 100`,
  ).all<{ id: string; raw_object_key: string | null }>();
  for (const message of messages.results) {
    const attachments = await context.env.DB.prepare(
      "SELECT object_key FROM message_attachments WHERE message_id = ?",
    )
      .bind(message.id)
      .all<{ object_key: string }>();
    for (const attachment of attachments.results) {
      await context.env.ATTACHMENTS.delete(attachment.object_key);
    }
    if (message.raw_object_key) {
      await context.env.ATTACHMENTS.delete(message.raw_object_key);
    }
    await context.env.DB.prepare("DELETE FROM messages WHERE id = ?")
      .bind(message.id)
      .run();
  }
  context.logger.info("maintenance.messages.retained", {
    removed: messages.results.length,
  });
}

async function cleanupOrphanObjects(context: AppContext): Promise<void> {
  const state = await context.env.DB.prepare(
    `SELECT cursor_json FROM maintenance_jobs
     WHERE job_key = 'orphan-object-cleanup'`,
  ).first<{ cursor_json: string }>();
  const stored = state
    ? (JSON.parse(state.cursor_json) as { cursor?: string })
    : {};
  const listing = await context.env.ATTACHMENTS.list({
    limit: 100,
    ...(stored.cursor ? { cursor: stored.cursor } : {}),
  });
  let removed = 0;
  for (const object of listing.objects) {
    if (Date.now() - object.uploaded.getTime() < 24 * 60 * 60 * 1000) {
      continue;
    }
    const reference = await context.env.DB.prepare(
      `SELECT 1 FROM messages WHERE raw_object_key = ?
       UNION ALL
       SELECT 1 FROM message_attachments WHERE object_key = ?
       UNION ALL
       SELECT 1 FROM attachment_uploads
       WHERE object_key = ? AND status IN ('pending', 'uploaded', 'consumed')
       LIMIT 1`,
    )
      .bind(object.key, object.key, object.key)
      .first();
    if (!reference) {
      await context.env.ATTACHMENTS.delete(object.key);
      removed += 1;
    }
  }
  await context.env.DB.prepare(
    `INSERT INTO maintenance_jobs (
       id, job_key, migration_name, status, cursor_json, attempts
     ) VALUES (?, 'orphan-object-cleanup', 'runtime-retention', ?, ?, ?)
     ON CONFLICT(job_key) DO UPDATE SET
       status = excluded.status,
       cursor_json = excluded.cursor_json,
       attempts = maintenance_jobs.attempts + excluded.attempts,
       updated_at = CURRENT_TIMESTAMP,
       completed_at = CASE WHEN excluded.status = 'completed'
         THEN CURRENT_TIMESTAMP ELSE NULL END`,
  )
    .bind(
      crypto.randomUUID(),
      listing.truncated ? "pending" : "completed",
      JSON.stringify({
        cursor: listing.truncated ? listing.cursor : undefined,
      }),
      removed,
    )
    .run();
  context.logger.info("maintenance.orphans.scanned", {
    scanned: listing.objects.length,
    removed,
    truncated: listing.truncated,
  });
}

const maintenanceHandlers: Record<
  string,
  (
    context: AppContext,
    cursor: unknown,
  ) => Promise<{
    complete: boolean;
    cursor: unknown;
    processed: number;
  }>
> = {};

async function processMaintenanceJobs(context: AppContext): Promise<void> {
  const jobs = await context.env.DB.prepare(
    `SELECT id, job_key, cursor_json
     FROM maintenance_jobs
     WHERE status IN ('pending', 'running')
       AND job_key != 'orphan-object-cleanup'
     ORDER BY created_at
     LIMIT 5`,
  ).all<{ id: string; job_key: string; cursor_json: string }>();
  for (const job of jobs.results) {
    const handler = maintenanceHandlers[job.job_key];
    if (!handler) {
      await context.env.DB.prepare(
        `UPDATE maintenance_jobs
         SET status = 'failed', last_error = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
        .bind(`No registered handler for ${job.job_key}`, job.id)
        .run();
      continue;
    }
    const result = await handler(context, JSON.parse(job.cursor_json));
    await context.env.DB.prepare(
      `UPDATE maintenance_jobs
       SET status = ?, cursor_json = ?,
           attempts = attempts + ?,
           updated_at = CURRENT_TIMESTAMP,
           completed_at = CASE WHEN ? = 'completed'
             THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = ?`,
    )
      .bind(
        result.complete ? "completed" : "pending",
        JSON.stringify(result.cursor),
        result.processed,
        result.complete ? "completed" : "pending",
        job.id,
      )
      .run();
  }
}
