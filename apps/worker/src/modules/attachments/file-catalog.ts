import type { AppContext } from "../../app-context";
import type {
  AttachmentMetadata,
  AttachmentObject,
} from "../../platform/attachment-store";

type AttachmentFileContext = Pick<AppContext, "env" | "attachmentStore">;
type AttachmentBody = AttachmentObject["body"] | Blob;

export interface AttachmentFileRecord {
  fileId: string;
  objectKey: string;
  md5: string;
  sizeBytes: number;
  created: boolean;
}

interface AttachmentFileRow {
  id: string;
  object_key: string;
  md5: string | null;
  size_bytes: number;
}

const shifts = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
] as const;
const constants = Array.from(
  { length: 64 },
  (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000) >>> 0,
);

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/** Incremental RFC 1321 MD5 implementation for Worker streams. */
export class Md5 {
  private readonly state = new Uint32Array([
    0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476,
  ]);
  private readonly pending = new Uint8Array(64);
  private pendingLength = 0;
  private byteLength = 0;
  private finished = false;

  update(bytes: Uint8Array): this {
    if (this.finished) throw new Error("MD5 digest has already been finalized");
    this.byteLength += bytes.byteLength;
    let offset = 0;
    while (offset < bytes.byteLength) {
      const length = Math.min(
        64 - this.pendingLength,
        bytes.byteLength - offset,
      );
      this.pending.set(
        bytes.subarray(offset, offset + length),
        this.pendingLength,
      );
      this.pendingLength += length;
      offset += length;
      if (this.pendingLength === 64) {
        this.transform(this.pending);
        this.pendingLength = 0;
      }
    }
    return this;
  }

  hex(): string {
    if (this.finished) throw new Error("MD5 digest has already been finalized");
    const bitLength = this.byteLength * 8;
    const paddingLength =
      this.pendingLength < 56
        ? 56 - this.pendingLength
        : 120 - this.pendingLength;
    const padding = new Uint8Array(paddingLength + 8);
    padding[0] = 0x80;
    const view = new DataView(padding.buffer);
    view.setUint32(paddingLength, bitLength >>> 0, true);
    view.setUint32(
      paddingLength + 4,
      Math.floor(bitLength / 0x1_0000_0000) >>> 0,
      true,
    );
    this.update(padding);
    this.finished = true;
    const output = new Uint8Array(16);
    const outputView = new DataView(output.buffer);
    for (let index = 0; index < this.state.length; index += 1) {
      outputView.setUint32(index * 4, this.state[index] ?? 0, true);
    }
    return Array.from(output, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }

  private transform(block: Uint8Array): void {
    const words = new Uint32Array(16);
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    for (let index = 0; index < words.length; index += 1) {
      words[index] = view.getUint32(index * 4, true);
    }
    let [a, b, c, d] = this.state;
    for (let index = 0; index < 64; index += 1) {
      let mixed: number;
      let wordIndex: number;
      if (index < 16) {
        mixed = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        mixed = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        mixed = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const previousD = d;
      d = c;
      c = b;
      b =
        (b +
          rotateLeft(
            (a + mixed + (constants[index] ?? 0) + (words[wordIndex] ?? 0)) >>>
              0,
            shifts[index] ?? 0,
          )) >>>
        0;
      a = previousD;
    }
    this.state[0] = ((this.state[0] ?? 0) + a) >>> 0;
    this.state[1] = ((this.state[1] ?? 0) + b) >>> 0;
    this.state[2] = ((this.state[2] ?? 0) + c) >>> 0;
    this.state[3] = ((this.state[3] ?? 0) + d) >>> 0;
  }
}

async function* bodyChunks(body: AttachmentBody): AsyncGenerator<Uint8Array> {
  if (body instanceof Uint8Array) {
    yield body;
    return;
  }
  if (body instanceof ArrayBuffer) {
    yield new Uint8Array(body);
    return;
  }
  if (body instanceof Blob) {
    yield* bodyChunks(body.stream());
    return;
  }
  const reader = body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value?.byteLength) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function md5Hex(body: AttachmentBody): Promise<string> {
  const md5 = new Md5();
  for await (const chunk of bodyChunks(body)) md5.update(chunk);
  return md5.hex();
}

async function bodiesEqual(
  left: AttachmentBody,
  right: AttachmentBody,
): Promise<boolean> {
  const leftIterator = bodyChunks(left)[Symbol.asyncIterator]();
  const rightIterator = bodyChunks(right)[Symbol.asyncIterator]();
  let leftChunk = new Uint8Array();
  let rightChunk = new Uint8Array();
  let leftOffset = 0;
  let rightOffset = 0;
  let leftDone = false;
  let rightDone = false;
  while (true) {
    if (leftOffset === leftChunk.byteLength && !leftDone) {
      const next = await leftIterator.next();
      leftDone = next.done ?? false;
      leftChunk = next.value ?? new Uint8Array();
      leftOffset = 0;
    }
    if (rightOffset === rightChunk.byteLength && !rightDone) {
      const next = await rightIterator.next();
      rightDone = next.done ?? false;
      rightChunk = next.value ?? new Uint8Array();
      rightOffset = 0;
    }
    if (leftDone || rightDone) return leftDone === rightDone;
    const length = Math.min(
      leftChunk.byteLength - leftOffset,
      rightChunk.byteLength - rightOffset,
    );
    for (let index = 0; index < length; index += 1) {
      if (leftChunk[leftOffset + index] !== rightChunk[rightOffset + index]) {
        await leftIterator.return?.(undefined);
        await rightIterator.return?.(undefined);
        return false;
      }
    }
    leftOffset += length;
    rightOffset += length;
  }
}

async function findIdenticalCandidate(
  context: AttachmentFileContext,
  objectKey: string,
  md5: string,
  sizeBytes: number,
  excludeFileId?: string,
): Promise<AttachmentFileRow | null> {
  const result = await context.env.DB.prepare(
    `SELECT id, object_key, md5, size_bytes
     FROM attachment_files
     WHERE md5 = ? AND size_bytes = ? AND (? IS NULL OR id != ?)
     ORDER BY created_at, id`,
  )
    .bind(md5, sizeBytes, excludeFileId ?? null, excludeFileId ?? null)
    .all<AttachmentFileRow>();
  for (const candidate of result.results) {
    const [candidateObject, incomingObject] = await Promise.all([
      context.attachmentStore.get(candidate.object_key),
      context.attachmentStore.get(objectKey),
    ]);
    if (
      candidateObject &&
      incomingObject &&
      candidateObject.size === sizeBytes &&
      incomingObject.size === sizeBytes &&
      (await bodiesEqual(candidateObject.body, incomingObject.body))
    ) {
      return candidate;
    }
  }
  return null;
}

async function registerStoredFile(
  context: AttachmentFileContext,
  objectKey: string,
  md5: string,
  sizeBytes: number,
): Promise<AttachmentFileRecord> {
  const existing = await findIdenticalCandidate(
    context,
    objectKey,
    md5,
    sizeBytes,
  );
  if (existing) {
    if (existing.object_key !== objectKey) {
      await context.attachmentStore.delete(objectKey);
    }
    return {
      fileId: existing.id,
      objectKey: existing.object_key,
      md5,
      sizeBytes,
      created: false,
    };
  }

  const id = crypto.randomUUID();
  const baseDedupeKey = `${md5}:${sizeBytes}`;
  try {
    await context.env.DB.prepare(
      `INSERT INTO attachment_files (
         id, object_key, dedupe_key, md5, size_bytes
       ) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, objectKey, baseDedupeKey, md5, sizeBytes)
      .run();
  } catch (error) {
    const raced = await findIdenticalCandidate(
      context,
      objectKey,
      md5,
      sizeBytes,
    );
    if (raced) {
      await context.attachmentStore.delete(objectKey);
      return {
        fileId: raced.id,
        objectKey: raced.object_key,
        md5,
        sizeBytes,
        created: false,
      };
    }
    try {
      await context.env.DB.prepare(
        `INSERT INTO attachment_files (
           id, object_key, dedupe_key, md5, size_bytes
         ) VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(id, objectKey, `${baseDedupeKey}:${id}`, md5, sizeBytes)
        .run();
    } catch {
      throw error;
    }
  }
  return { fileId: id, objectKey, md5, sizeBytes, created: true };
}

export async function storeAttachmentFile(
  context: AttachmentFileContext,
  input: {
    objectKey: string;
    body: AttachmentBody;
    sizeBytes: number;
    metadata: AttachmentMetadata;
  },
): Promise<AttachmentFileRecord> {
  let storageBody: AttachmentBody = input.body;
  let digestBody: AttachmentBody = input.body;
  if (input.body instanceof ReadableStream) {
    [storageBody, digestBody] = input.body.tee();
  }
  const [, md5] = await Promise.all([
    context.attachmentStore.put(input.objectKey, storageBody, input.metadata),
    md5Hex(digestBody),
  ]);
  return registerStoredFile(context, input.objectKey, md5, input.sizeBytes);
}

export async function deleteAttachmentFileIfUnreferenced(
  context: AttachmentFileContext,
  fileId: string | null,
): Promise<void> {
  if (!fileId) return;
  const file = await context.env.DB.prepare(
    `SELECT id, object_key, md5, size_bytes FROM attachment_files WHERE id = ?`,
  )
    .bind(fileId)
    .first<AttachmentFileRow>();
  if (!file) return;
  const deleted = await context.env.DB.prepare(
    `DELETE FROM attachment_files
     WHERE id = ?
       AND NOT EXISTS (
         SELECT 1 FROM message_attachments WHERE file_id = ?
       )
       AND NOT EXISTS (
         SELECT 1 FROM attachment_uploads
         WHERE file_id = ? AND status IN ('pending', 'uploaded')
       )`,
  )
    .bind(fileId, fileId, fileId)
    .run();
  // D1 includes ON DELETE SET NULL updates to consumed upload rows in the
  // change count, so a successful file delete can report more than one change.
  if ((deleted.meta.changes ?? 0) > 0) {
    await context.attachmentStore.delete(file.object_key);
  }
}

export async function backfillAttachmentFileMd5(
  context: AttachmentFileContext,
  file: AttachmentFileRow,
): Promise<void> {
  const object = await context.attachmentStore.get(file.object_key);
  if (!object)
    throw new Error(`Attachment object ${file.object_key} is missing`);
  const md5 = await md5Hex(object.body);
  const candidate = await findIdenticalCandidate(
    context,
    file.object_key,
    md5,
    file.size_bytes,
    file.id,
  );
  if (candidate) {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE message_attachments
         SET file_id = ?, object_key = ?, md5 = ? WHERE file_id = ?`,
      ).bind(candidate.id, candidate.object_key, md5, file.id),
      context.env.DB.prepare(
        `UPDATE attachment_uploads
         SET file_id = ?, md5 = ? WHERE file_id = ?`,
      ).bind(candidate.id, md5, file.id),
      context.env.DB.prepare(
        `DELETE FROM attachment_files
         WHERE id = ?
           AND NOT EXISTS (SELECT 1 FROM message_attachments WHERE file_id = ?)
           AND NOT EXISTS (SELECT 1 FROM attachment_uploads WHERE file_id = ?)`,
      ).bind(file.id, file.id, file.id),
    ]);
    if (candidate.object_key !== file.object_key) {
      await context.attachmentStore.delete(file.object_key);
    }
    return;
  }
  const baseDedupeKey = `${md5}:${file.size_bytes}`;
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE attachment_files
         SET md5 = ?, dedupe_key = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND md5 IS NULL`,
      ).bind(md5, baseDedupeKey, file.id),
      context.env.DB.prepare(
        "UPDATE message_attachments SET md5 = ? WHERE file_id = ?",
      ).bind(md5, file.id),
      context.env.DB.prepare(
        "UPDATE attachment_uploads SET md5 = ? WHERE file_id = ?",
      ).bind(md5, file.id),
    ]);
  } catch {
    await context.env.DB.prepare(
      `UPDATE attachment_files
       SET md5 = ?, dedupe_key = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND md5 IS NULL`,
    )
      .bind(md5, `${baseDedupeKey}:${file.id}`, file.id)
      .run();
    await context.env.DB.batch([
      context.env.DB.prepare(
        "UPDATE message_attachments SET md5 = ? WHERE file_id = ?",
      ).bind(md5, file.id),
      context.env.DB.prepare(
        "UPDATE attachment_uploads SET md5 = ? WHERE file_id = ?",
      ).bind(md5, file.id),
    ]);
  }
}

export type { AttachmentFileRow };
