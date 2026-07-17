import type { RuntimeConfig } from "@cf-startup/shared";
import { Hono } from "hono";
import { z } from "zod";
import { can } from "../auth";
import { fail, ok } from "../http";
import type { Env } from "../types";

const configSchema = z.object({
  value: z.string().max(1000)
});

export const configRoutes = new Hono<Env>()
  .get("/:key", can("config:manage"), async (c) => {
    const key = c.req.param("key");
    const value = await c.env.APP_KV.get(key);

    if (value === null) {
      return fail("config_not_found", "Config value not found.", 404);
    }

    return ok({ key, value } satisfies RuntimeConfig);
  })
  .put("/:key", can("config:manage"), async (c) => {
    const key = c.req.param("key");
    const parsed = configSchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) {
      return fail("invalid_config", "Config value is required.", 400);
    }

    await c.env.APP_KV.put(key, parsed.data.value);
    return ok({ key, value: parsed.data.value } satisfies RuntimeConfig);
  });
