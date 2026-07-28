import type { Env } from "../../platform/config";

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
}

export class HealthService {
  constructor(private readonly env: Env) {}

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
    return {
      status: Object.values(checks).every(
        (value) => value === "ok" || value === "pending",
      )
        ? "ok"
        : "degraded",
      checks,
    };
  }
}
