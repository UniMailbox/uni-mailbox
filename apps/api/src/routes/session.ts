import { Hono } from "hono";
import { currentSession } from "../auth";
import { ok } from "../http";
import type { Env } from "../types";

export const sessionRoutes = new Hono<Env>().get("/", (c) => ok(currentSession(c)));
