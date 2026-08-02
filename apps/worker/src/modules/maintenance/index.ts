import type { Env } from "../../platform/config";
import type { StorageBackend } from "../../platform/attachment-store";
import packageMetadata from "../../../../../package.json";

const SCHEDULED_STARTUP_WINDOW_MS = 10 * 60 * 1000;

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
  release: {
    applicationVersion: string;
    upstreamVersion: string;
    workerVersionId: string | null;
    workerVersionTag: string | null;
    deployedAt: string | null;
  };
  operationalAlerts: string[];
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
        const deployedAt = Date.parse(
          this.env.CF_VERSION_METADATA?.timestamp ?? "",
        );
        checks.scheduled =
          lastRun === 0
            ? Number.isFinite(deployedAt) &&
              Date.now() - deployedAt > SCHEDULED_STARTUP_WINDOW_MS
              ? "stale"
              : "pending"
            : Date.now() - lastRun <= 5 * 60 * 1000
              ? "ok"
              : "stale";
      } catch {
        checks.kv = "error";
        checks.scheduled = "error";
      }
    }
    const requiredChecks = [
      checks.database,
      checks.kv,
      checks.queue,
      checks.assets,
      ...(this.backend === "r2" ? [checks.r2] : []),
    ];
    const operationalAlerts = [];
    if (checks.scheduled === "stale") {
      operationalAlerts.push("scheduled_trigger_stale");
    } else if (checks.scheduled === "error") {
      operationalAlerts.push("scheduled_trigger_check_failed");
    }
    return {
      status: requiredChecks.every((value) => value === "ok")
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
      release: {
        applicationVersion: packageMetadata.version,
        upstreamVersion: packageMetadata.version,
        workerVersionId: this.env.CF_VERSION_METADATA?.id ?? null,
        workerVersionTag: this.env.CF_VERSION_METADATA?.tag ?? null,
        deployedAt: this.env.CF_VERSION_METADATA?.timestamp ?? null,
      },
      operationalAlerts,
    };
  }
}
