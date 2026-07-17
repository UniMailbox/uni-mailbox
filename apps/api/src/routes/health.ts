import { Hono } from "hono";
import { ok } from "../http";
import type { Env } from "../types";

export const healthRoutes = new Hono<Env>().get("/", (c) =>
  ok({
    service: "cf-startup-api",
    env: c.env.APP_ENV,
    bindings: {
      d1: Boolean(c.env.DB),
      kv: Boolean(c.env.APP_KV),
      r2: Boolean(c.env.FILE_BUCKET)
    }
  })
);
