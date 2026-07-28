import type { AttachmentObject } from "../../platform/attachment-store";

interface AttachmentDownloadMetadata {
  filename: string | null;
  mimeType: string;
  disposition: "attachment" | "inline";
}

const INLINE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function dispositionHeader(
  disposition: "attachment" | "inline",
  filename: string,
): string {
  return `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function createAttachmentDownloadResponse(
  object: AttachmentObject,
  attachment: AttachmentDownloadMetadata,
): Promise<Response> {
  const etag =
    object.etag ??
    (object.body instanceof ReadableStream
      ? undefined
      : await weakEtag(object.body));
  const disposition =
    attachment.disposition === "inline" &&
    INLINE_MIME_TYPES.has(attachment.mimeType)
      ? "inline"
      : "attachment";
  const headers = new Headers({
    "content-type": attachment.mimeType,
    "content-length": String(object.size),
    "content-disposition": dispositionHeader(
      disposition,
      attachment.filename ?? "attachment",
    ),
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  });
  if (etag) headers.set("etag", etag);
  return new Response(object.body as BodyInit, { headers });
}

async function weakEtag(body: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = body instanceof Uint8Array ? body.slice().buffer : body;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `W/"${hex.slice(0, 32)}"`;
}
