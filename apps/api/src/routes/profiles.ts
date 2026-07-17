import type { Profile } from "@cf-startup/shared";
import { Hono } from "hono";
import { z } from "zod";
import { can } from "../auth";
import { writeAudit } from "../audit";
import { fail, ok } from "../http";
import type { Env } from "../types";

const createProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120)
});

type ProfileRow = {
  id: string;
  display_name: string;
  title: string;
  created_at: string;
};

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    title: row.title,
    createdAt: row.created_at
  };
}

export const profileRoutes = new Hono<Env>()
  .get("/", can("profile:read"), async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT id, display_name, title, created_at FROM profiles ORDER BY created_at DESC"
    ).all<ProfileRow>();

    return ok(results.map(mapProfile));
  })
  .post("/", can("profile:write"), async (c) => {
    const parsed = createProfileSchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) {
      return fail("invalid_profile", "Display name and title are required.", 400);
    }

    const id = crypto.randomUUID();
    const principal = c.get("principal");

    await c.env.DB.prepare("INSERT INTO profiles (id, display_name, title) VALUES (?, ?, ?)")
      .bind(id, parsed.data.displayName, parsed.data.title)
      .run();
    await writeAudit(c.env.DB, principal, "profile.created", id);

    return ok(
      {
        id,
        displayName: parsed.data.displayName,
        title: parsed.data.title,
        createdAt: new Date().toISOString()
      } satisfies Profile,
      { status: 201 }
    );
  });
