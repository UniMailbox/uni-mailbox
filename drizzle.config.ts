import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./apps/worker/src/platform/schema.ts",
  out: "../../.wrangler/drizzle",
});
