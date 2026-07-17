import type { StoredFile } from "@cf-startup/shared";
import { Hono } from "hono";
import { can } from "../auth";
import { writeAudit } from "../audit";
import { fail, ok } from "../http";
import type { Env } from "../types";

type FileRow = {
  key: string;
  filename: string;
  content_type: string;
  size: number;
  uploaded_by: string;
  created_at: string;
};

function mapFile(row: FileRow): StoredFile {
  return {
    key: row.key,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at
  };
}

export const fileRoutes = new Hono<Env>()
  .get("/", can("file:read"), async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT key, filename, content_type, size, uploaded_by, created_at FROM stored_files ORDER BY created_at DESC"
    ).all<FileRow>();

    return ok(results.map(mapFile));
  })
  .get("/:key", can("file:read"), async (c) => {
    const key = c.req.param("key");
    const object = await c.env.FILE_BUCKET.get(key);

    if (!object) {
      return fail("file_not_found", "File not found.", 404);
    }

    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "etag": object.httpEtag
      }
    });
  })
  .post("/", can("file:write"), async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");

    if (!(file instanceof File)) {
      return fail("invalid_file", "Upload a file field named file.", 400);
    }

    if (file.size > 5 * 1024 * 1024) {
      return fail("file_too_large", "Files must be 5 MB or smaller.", 413);
    }

    const principal = c.get("principal");
    const key = `${principal.id}/${crypto.randomUUID()}-${file.name.replaceAll("/", "_")}`;
    const contentType = file.type || "application/octet-stream";

    await c.env.FILE_BUCKET.put(key, file.stream(), {
      httpMetadata: {
        contentType
      }
    });
    await c.env.DB.prepare(
      "INSERT INTO stored_files (key, filename, content_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(key, file.name, contentType, file.size, principal.id)
      .run();
    await writeAudit(c.env.DB, principal, "file.uploaded", key);

    return ok(
      {
        key,
        filename: file.name,
        contentType,
        size: file.size,
        uploadedBy: principal.id,
        createdAt: new Date().toISOString()
      } satisfies StoredFile,
      { status: 201 }
    );
  });
