/**
 * Scheduled-trigger heartbeat format and freshness policy.
 *
 * The hourly cron drives the worker — when it stops, lots of background
 * work silently freezes. To keep `/health` honest about that, the cron
 * writes a heartbeat on every tick. The heartbeat is *also* the diagnostic
 * signal: a run that starts but then throws gets a chance to mark itself
 * `degraded` before the throw propagates.
 *
 * Frequency policy:
 * - Healthy ticks: the cron only writes at the top of the hour (minute 0).
 *   That cuts the heartbeat write volume from 1440/day to 24/day.
 * - Degraded ticks: the cron writes every minute so a failing scheduled
 *   handler is visible at the same cadence as before.
 * - Recovery: when a previously-degraded cron produces a healthy run, the
 *   next hourly tick restores the regular cadence; intermediate healthy
 *   ticks stay quiet to keep write volume low.
 *
 * Backward compatibility: readers must accept both the new JSON object and
 * the legacy plain-number string, since older deployments (and the
 * integration test fixture) may still write the latter.
 */

import type { AppContext } from "../../app-context";

export const HEARTBEAT_KEY = "health:scheduled:last_run";
/** Per-hour cron is allowed to miss a single tick before we flag it. */
export const HEALTHY_HEARTBEAT_FRESHNESS_MS = 70 * 60 * 1000;
/** An older heartbeat is treated as a missing one for the startup window. */
export const SCHEDULED_STARTUP_WINDOW_MS = 10 * 60 * 1000;

export type HeartbeatStatus = "ok" | "degraded";

export interface HeartbeatRecord {
  /** Unix epoch milliseconds of the cron invocation. */
  timestamp: number;
  status: HeartbeatStatus;
  /** Why the cron marked itself degraded; omitted for healthy records. */
  reason?: string;
}

/**
 * Persist the heartbeat if the current minute qualifies. Returns the rule
 * that was applied, which keeps the call site honest about the path it took.
 */
export type HeartbeatWriteDecision =
  | "ok-hourly"
  | "ok-recovery"
  | "degraded-keepalive"
  | "skipped";

/**
 * Parse whatever the last cron invocation left behind. Both the new JSON
 * shape and the legacy plain-number string are accepted; malformed values
 * are treated as "never recorded".
 */
export function parseHeartbeat(raw: string | null): HeartbeatRecord | null {
  if (raw === null || raw === "") return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && /^\d+$/.test(raw.trim())) {
    return { timestamp: asNumber, status: "ok" };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<HeartbeatRecord>;
    if (
      typeof parsed?.timestamp === "number" &&
      (parsed.status === "ok" || parsed.status === "degraded")
    ) {
      return {
        timestamp: parsed.timestamp,
        status: parsed.status,
        ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
      };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Decide whether the cron should persist a heartbeat for the current
 * invocation. Encapsulated so the test suite can exercise the matrix
 * without stubbing `Date`.
 */
export function shouldWriteHeartbeat(
  previous: HeartbeatRecord | null,
  status: HeartbeatStatus,
  now: number,
): HeartbeatWriteDecision {
  if (status === "degraded") return "degraded-keepalive";
  const date = new Date(now);
  if (date.getUTCMinutes() === 0) return "ok-hourly";
  // A healthy recovery: the previous tick was degraded (or absent) and we
  // are now healthy, but it's not the top of the hour. Write once so the
  // next reader sees the transition without waiting an hour.
  if (previous?.status === "degraded") return "ok-recovery";
  return "skipped";
}

/**
 * Run the cron payload under a heartbeat-aware guard. A throw inside
 * `tick` is converted into a `degraded` heartbeat (best effort — if KV
 * itself is down, the catch is swallowed) and then rethrown so the rest
 * of the worker can keep behaving like a normal scheduled failure.
 */
export async function runWithHeartbeat(
  context: AppContext,
  scheduledTime: number,
  tick: () => Promise<void>,
): Promise<void> {
  const previous = parseHeartbeat(await context.env.KV.get(HEARTBEAT_KEY));
  let status: HeartbeatStatus = "ok";
  let reason: string | undefined;
  try {
    await tick();
  } catch (error) {
    status = "degraded";
    reason =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "scheduled_tick_failed";
    try {
      await writeHeartbeat(context, scheduledTime, status, reason);
    } catch {
      // KV itself is unhealthy. The next /health probe will surface it
      // via the storage check; we still want the original failure to
      // surface to the worker's normal error reporting path.
    }
    throw error;
  }
  const decision = shouldWriteHeartbeat(previous, status, scheduledTime);
  if (decision === "skipped") return;
  await writeHeartbeat(context, scheduledTime, status, reason);
}

export async function writeHeartbeat(
  context: AppContext,
  scheduledTime: number,
  status: HeartbeatStatus,
  reason?: string,
): Promise<void> {
  const record: HeartbeatRecord = reason
    ? { timestamp: scheduledTime, status, reason }
    : { timestamp: scheduledTime, status };
  await context.env.KV.put(HEARTBEAT_KEY, JSON.stringify(record), {
    // Two-day TTL so the value can still be read after a missed tick and
    // parses deterministically. KV only respects TTLs >= 60s.
    expirationTtl: 2 * 24 * 60 * 60,
  });
}
