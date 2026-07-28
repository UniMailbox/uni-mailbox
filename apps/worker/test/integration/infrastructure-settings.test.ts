import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@unimailbox/contracts";
import { InfrastructureSettingsService } from "../../src/modules/administration/infrastructure-settings";
import { HealthService } from "../../src/modules/maintenance";
import { makeEnv } from "./env-fixture";

const administrator: Principal = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.com",
  permissions: new Set(["settings.manage"]),
};

describe("infrastructure settings", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it("reports KV as the healthy default when optional R2 is absent", async () => {
    const runtime = makeEnv({ withoutR2: true });
    const service = new InfrastructureSettingsService(
      runtime,
      new HealthService(runtime, "kv"),
    );

    await expect(service.getStatus(administrator)).resolves.toMatchObject({
      required: {
        d1: "ok",
        kv: "ok",
        queue: "ok",
        assets: "ok",
      },
      attachments: {
        backend: "kv",
        r2: "missing",
      },
    });
    await expect(service.verifyR2(administrator)).rejects.toMatchObject({
      code: "R2_NOT_CONFIGURED",
      status: 409,
    });
  });

  it("writes, reads, and removes a namespaced R2 probe", async () => {
    const runtime = makeEnv();
    const service = new InfrastructureSettingsService(
      runtime,
      new HealthService(runtime, "r2"),
    );

    await expect(service.verifyR2(administrator)).resolves.toMatchObject({
      status: "verified",
      backend: "r2",
    });
    const objects = await runtime.ATTACHMENTS?.list({
      prefix: "unimailbox-health/",
    });
    expect(objects?.objects).toHaveLength(0);
  });
});
