import { DomainError, type Principal } from "@unimailbox/contracts";
import type { HealthService } from "../maintenance";
import type { Env } from "../../platform/config";

type ResourceStatus = "ok" | "missing" | "error";

export interface InfrastructureStatus {
  required: {
    d1: ResourceStatus;
    kv: ResourceStatus;
    queue: ResourceStatus;
    assets: ResourceStatus;
  };
  attachments: {
    backend: "kv" | "r2";
    r2: ResourceStatus;
    reason: string;
  };
}

export class InfrastructureSettingsService {
  constructor(
    private readonly env: Env,
    private readonly health: Pick<HealthService, "check">,
  ) {}

  async getStatus(principal: Principal): Promise<InfrastructureStatus> {
    this.requireManageSettings(principal);
    const health = await this.health.check();
    return {
      required: {
        d1: health.checks.database,
        kv: health.checks.kv,
        queue: health.checks.queue,
        assets: health.checks.assets,
      },
      attachments: {
        backend: health.storage.backend,
        r2: health.checks.r2,
        reason: health.storage.reason,
      },
    };
  }

  async verifyR2(
    principal: Principal,
  ): Promise<{ status: "verified"; backend: "r2" }> {
    this.requireManageSettings(principal);
    const bucket = this.env.ATTACHMENTS;
    if (!bucket) {
      throw new DomainError(
        "R2_NOT_CONFIGURED",
        "The optional ATTACHMENTS R2 binding is not configured",
        409,
      );
    }
    const key = `unimailbox-health/${crypto.randomUUID()}`;
    try {
      await bucket.put(key, new Uint8Array([1]), {
        customMetadata: { purpose: "r2-connectivity-probe" },
      });
      const object = await bucket.head(key);
      if (!object || object.size !== 1) {
        throw new DomainError(
          "R2_VERIFICATION_FAILED",
          "The R2 connectivity probe could not be read",
          502,
        );
      }
      await this.env.DB.prepare(
        `UPDATE configuration_checkpoints
         SET status = 'verified', metadata_json = '{"backend":"r2"}',
             error_code = NULL, error_message = NULL,
             verified_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE checkpoint_key = 'r2_storage'`,
      ).run();
      return { status: "verified", backend: "r2" };
    } catch (error) {
      const domainError =
        error instanceof DomainError
          ? error
          : new DomainError(
              "R2_VERIFICATION_FAILED",
              "The R2 connectivity probe failed",
              502,
            );
      await this.env.DB.prepare(
        `UPDATE configuration_checkpoints
         SET status = 'failed', error_code = ?, error_message = ?,
             verified_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE checkpoint_key = 'r2_storage'`,
      )
        .bind(domainError.code, domainError.message)
        .run();
      throw domainError;
    } finally {
      await bucket.delete(key).catch(() => undefined);
    }
  }

  private requireManageSettings(principal: Principal): void {
    if (!principal.permissions.has("settings.manage")) {
      throw new DomainError(
        "PERMISSION_DENIED",
        "Permission settings.manage is required",
        403,
      );
    }
  }
}
