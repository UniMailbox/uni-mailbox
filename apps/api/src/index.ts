import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { attachPrincipal } from "./auth";
import { configRoutes } from "./routes/config";
import { fileRoutes } from "./routes/files";
import { healthRoutes } from "./routes/health";
import { profileRoutes } from "./routes/profiles";
import { sessionRoutes } from "./routes/session";
import type { Env } from "./types";
import { fail } from "./http";

const app = new Hono<Env>();

app.use("*", secureHeaders());
app.use("*", async (c, next) =>
  cors({
    origin: c.env.ALLOWED_ORIGIN || "*",
    allowHeaders: ["content-type", "x-user-id", "x-user-role"],
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    credentials: false
  })(c, next)
);
app.use("*", attachPrincipal);

app.route("/health", healthRoutes);
app.route("/session", sessionRoutes);
app.route("/profiles", profileRoutes);
app.route("/files", fileRoutes);
app.route("/config", configRoutes);

app.notFound(() => fail("not_found", "Route not found.", 404));
app.onError((error) => {
  console.error(error);
  return fail("internal_error", "An unexpected error occurred.", 500);
});

export default app;
