import type { Env } from "../../platform/config";
import type { StorageBackend } from "../../platform/attachment-store";

export interface HealthResult {
  status: "ok" | "degraded";
  checks: {
    database: "ok" | "missing" | "error";
    kv: "ok" | "missing" | "error";
    r2: "ok" | "missing" | "error";
    queue: "ok" | "missing" | "error";
    assets: "ok" | "missing" | "error";
    scheduled: "ok" | "pending" | "stale" | "error";
  };
  storage: {
    backend: StorageBackend;
    reason: string;
  };
}

export class HealthService {
  constructor(
    private readonly env: Env,
    private readonly backend: StorageBackend,
  ) {}

  async check(): Promise<HealthResult> {
    const checks: HealthResult["checks"] = {
      database: this.env.DB ? "ok" : "missing",
      kv: this.env.KV ? "ok" : "missing",
      r2: this.env.ATTACHMENTS ? "ok" : "missing",
      queue: this.env.OUTBOUND_QUEUE ? "ok" : "missing",
      assets: this.env.ASSETS ? "ok" : "missing",
      scheduled: "pending",
    };
    if (this.env.DB) {
      try {
        await this.env.DB.prepare("SELECT 1 AS healthy").first();
      } catch {
        checks.database = "error";
      }
    }
    if (this.env.KV) {
      try {
        const lastRun = Number(
          (await this.env.KV.get("health:scheduled:last_run")) ?? 0,
        );
        checks.scheduled =
          lastRun === 0
            ? "pending"
            : Date.now() - lastRun <= 5 * 60 * 1000
              ? "ok"
              : "stale";
      } catch {
        checks.scheduled = "error";
      }
    }
    const requiredChecks = [
      checks.database,
      checks.kv,
      checks.queue,
      checks.assets,
      checks.scheduled,
      ...(this.backend === "r2" ? [checks.r2] : []),
    ];
    return {
      status: requiredChecks.every(
        (value) => value === "ok" || value === "pending",
      )
        ? "ok"
        : "degraded",
      checks,
      storage: {
        backend: this.backend,
        reason:
          this.backend === "r2"
            ? "ATTACHMENTS binding is present in the Worker env"
            : "ATTACHMENTS binding is absent; KV is the default storage backend",
      },
    };
  }
}
