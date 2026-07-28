import { describe, expect, it, vi } from "vitest";
import {
  AttachmentMigrationError,
  WHOAMI_ARGS,
  createAttachmentMigration,
  r2ObjectUrl,
} from "./attachment-migration-lib.mjs";

function response(body, init = {}) {
  return new Response(
    typeof body === "string" || body instanceof ArrayBuffer
      ? body
      : JSON.stringify(body),
    init,
  );
}

function migrationWith(fetch = vi.fn(), capture = vi.fn(), output = vi.fn()) {
  return createAttachmentMigration({
    apiToken: "token",
    capture,
    fetch,
    output,
  });
}

function listResponse(keys, cursor) {
  return response({
    result: keys.map((name) => ({ name })),
    result_info: cursor ? { cursor } : {},
  });
}

const migrateInput = {
  account: "account-1",
  namespaceId: "namespace-id",
  bucket: "bucket",
  prefix: "attachment:",
  dryRun: false,
};

describe("attachment migration", () => {
  it("uses Wrangler's supported JSON flag", async () => {
    expect(WHOAMI_ARGS).toEqual(["exec", "wrangler", "whoami", "--json"]);
    const capture = vi.fn().mockReturnValue({
      ok: true,
      stdout: JSON.stringify({ account: { id: "account-1" } }),
      stderr: "",
    });
    const migration = createAttachmentMigration({
      apiToken: "token",
      capture,
      fetch: vi.fn(),
      output: vi.fn(),
    });

    await expect(migration.resolveAccountId()).resolves.toBe("account-1");
    expect(capture).toHaveBeenCalledWith("pnpm", WHOAMI_ARGS);
  });

  it("accepts an explicit account and all supported whoami response shapes", async () => {
    const explicitCapture = vi.fn();
    await expect(
      migrationWith(vi.fn(), explicitCapture).resolveAccountId("explicit"),
    ).resolves.toBe("explicit");
    expect(explicitCapture).not.toHaveBeenCalled();

    for (const payload of [
      { accounts: [{ id: "from-accounts" }] },
      { id: "from-root" },
    ]) {
      const capture = vi.fn().mockReturnValue({
        ok: true,
        stdout: JSON.stringify(payload),
        stderr: "",
      });
      await expect(
        migrationWith(vi.fn(), capture).resolveAccountId(),
      ).resolves.toMatch(/from-/u);
    }
  });

  it("requires an explicit account when whoami returns multiple accounts", async () => {
    const capture = vi.fn().mockReturnValue({
      ok: true,
      stdout: JSON.stringify({
        accounts: [{ id: "account-1" }, { id: "account-2" }],
      }),
      stderr: "",
    });

    await expect(
      migrationWith(vi.fn(), capture).resolveAccountId(),
    ).rejects.toMatchObject({
      event: "migration.account_ambiguous",
      exitCode: 5,
      fields: { accounts: ["account-1", "account-2"] },
    });
  });

  it("returns structured whoami failures", async () => {
    const unauthenticated = migrationWith(
      vi.fn(),
      vi.fn().mockReturnValue({
        ok: false,
        stdout: "",
        stderr: "not logged in",
      }),
    );
    await expect(unauthenticated.resolveAccountId()).rejects.toMatchObject({
      name: "AttachmentMigrationError",
      event: "migration.whoami_failed",
      exitCode: 4,
      fields: { stderr: "not logged in" },
    });

    for (const stdout of ["not-json", JSON.stringify({ account: {} })]) {
      const invalid = migrationWith(
        vi.fn(),
        vi.fn().mockReturnValue({ ok: true, stdout, stderr: "" }),
      );
      await expect(invalid.resolveAccountId()).rejects.toMatchObject({
        event: "migration.whoami_parse_failed",
        exitCode: 5,
      });
    }
  });

  it("builds the documented R2 object API path while preserving key slashes", () => {
    expect(r2ObjectUrl("account-1", "bucket name", "raw/folder/a b.eml")).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-1/r2/buckets/bucket%20name/objects/raw/folder/a%20b.eml",
    );
  });

  it("uses a configured namespace ID without listing namespaces", async () => {
    const fetch = vi.fn();
    const migration = createAttachmentMigration({
      apiToken: "token",
      capture: vi.fn(),
      fetch,
      output: vi.fn(),
    });

    await expect(
      migration.resolveNamespaceId("account-1", "namespace-id", "KV"),
    ).resolves.toBe("namespace-id");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves namespace titles and reports namespace API failures", async () => {
    const namespaceFetch = vi.fn().mockResolvedValueOnce(
      response({
        result: [
          { id: "other", title: "Other" },
          { id: "namespace-id", title: "KV" },
        ],
      }),
    );
    const found = migrationWith(namespaceFetch);
    await expect(
      found.resolveNamespaceId("account-1", null, "KV"),
    ).resolves.toBe("namespace-id");
    expect(String(namespaceFetch.mock.calls[0][0])).toContain("per_page=1000");

    const unavailable = migrationWith(
      vi.fn().mockResolvedValueOnce(response("denied", { status: 403 })),
    );
    await expect(
      unavailable.resolveNamespaceId("account-1", null, "KV"),
    ).rejects.toMatchObject({
      event: "migration.namespace_list_failed",
      exitCode: 6,
      fields: { body: "denied" },
    });

    const missing = migrationWith(
      vi.fn().mockResolvedValueOnce(response({ success: true })),
    );
    await expect(
      missing.resolveNamespaceId("account-1", null, "KV"),
    ).rejects.toMatchObject({
      event: "migration.namespace_not_found",
      exitCode: 7,
      fields: { available: [] },
    });
  });

  it("reports a missing object as planned work during dry-run without verifying it", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          result: [{ name: "attachment:attachments/a.txt" }],
          result_info: {},
        }),
      )
      .mockResolvedValueOnce(response(new Uint8Array([1, 2, 3]).buffer))
      .mockResolvedValueOnce(response("{}", { status: 200 }))
      .mockResolvedValueOnce(response("", { status: 404 }));
    const events = [];
    const migration = createAttachmentMigration({
      apiToken: "token",
      capture: vi.fn(),
      fetch,
      output: (event, fields) => events.push({ event, ...fields }),
    });

    const result = await migration.migrate({
      account: "account-1",
      namespaceId: "namespace-id",
      bucket: "bucket",
      prefix: "attachment:",
      dryRun: true,
    });

    expect(result).toMatchObject({
      listed: 1,
      planned: 1,
      uploaded: 0,
      failed: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(events.some((entry) => entry.event === "migration.key_failed")).toBe(
      false,
    );
  });

  it("never deletes a matching KV source during dry-run", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(listResponse(["attachment:attachments/a.txt"]))
      .mockResolvedValueOnce(response(new Uint8Array([1, 2, 3]).buffer))
      .mockResolvedValueOnce(response("{}"))
      .mockResolvedValueOnce(
        response("", { headers: { "content-length": "3" } }),
      );
    const result = await migrationWith(fetch).migrate({
      ...migrateInput,
      dryRun: true,
    });

    expect(result).toMatchObject({ skipped: 1, failed: 0 });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("uploads, verifies, and deletes KV data through the R2 object API", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          result: [{ name: "attachment:attachments/a.txt" }],
          result_info: {},
        }),
      )
      .mockResolvedValueOnce(response(new Uint8Array([1, 2, 3]).buffer))
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            httpMetadata: {
              contentType: "text/plain",
              contentDisposition: "attachment",
              contentLanguage: "en",
              contentEncoding: "gzip",
              cacheControl: "private",
            },
            customMetadata: {
              filename: "a.txt",
              uploadId: "upload-1",
              expectedSize: "3",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(response("", { status: 404 }))
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(
        response("", {
          status: 200,
          headers: {
            "content-length": "3",
            "content-type": "text/plain",
            "content-disposition": "attachment",
            "content-language": "en",
            "content-encoding": "gzip",
            "cache-control": "private",
            "x-amz-meta-filename": "a.txt",
            "x-amz-meta-uploadid": "upload-1",
            "x-amz-meta-expectedsize": "3",
          },
        }),
      )
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response({ success: true }));
    const migration = createAttachmentMigration({
      apiToken: "token",
      capture: vi.fn(),
      fetch,
      output: vi.fn(),
    });

    const result = await migration.migrate({
      account: "account-1",
      namespaceId: "namespace-id",
      bucket: "bucket",
      prefix: "attachment:",
      dryRun: false,
    });

    expect(result).toMatchObject({ uploaded: 1, failed: 0 });
    expect(fetch.mock.calls[3][0]).toContain(
      "/accounts/account-1/r2/buckets/bucket/objects/attachments/a.txt",
    );
    expect(fetch.mock.calls[4][0]).toContain(
      "/accounts/account-1/r2/buckets/bucket/objects/attachments/a.txt",
    );
    expect(fetch.mock.calls[4][1]).toMatchObject({ method: "PUT" });
    expect(fetch.mock.calls[4][1].headers).toMatchObject({
      "content-type": "text/plain",
      "content-disposition": "attachment",
      "content-language": "en",
      "content-encoding": "gzip",
      "cache-control": "private",
      "x-amz-meta-filename": "a.txt",
      "x-amz-meta-uploadid": "upload-1",
      "x-amz-meta-expectedsize": "3",
    });
  });

  it("plans a same-size object whose metadata is incomplete", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(listResponse(["attachment:attachments/a"]))
      .mockResolvedValueOnce(response(new Uint8Array([1]).buffer))
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            httpMetadata: { contentType: "text/plain" },
            customMetadata: { uploadId: "upload-1" },
          }),
        ),
      )
      .mockResolvedValueOnce(
        response("", { headers: { "content-length": "1" } }),
      );

    const result = await migrationWith(fetch).migrate({
      ...migrateInput,
      dryRun: true,
    });

    expect(result).toMatchObject({
      planned: 1,
      skipped: 0,
      failed: 0,
    });
  });

  it("plans a same-size object whose custom metadata differs", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(listResponse(["attachment:attachments/a"]))
      .mockResolvedValueOnce(response(new Uint8Array([1]).buffer))
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            httpMetadata: { contentType: "text/plain" },
            customMetadata: { uploadId: "expected-upload" },
          }),
        ),
      )
      .mockResolvedValueOnce(
        response("", {
          headers: {
            "content-length": "1",
            "content-type": "text/plain",
            "x-amz-meta-uploadid": "wrong-upload",
          },
        }),
      );

    const result = await migrationWith(fetch).migrate({
      ...migrateInput,
      dryRun: true,
    });

    expect(result).toMatchObject({
      planned: 1,
      skipped: 0,
      failed: 0,
    });
  });

  it("skips an already verified object and tolerates a missing metadata sidecar", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(listResponse(["attachment:raw/a.eml"]))
      .mockResolvedValueOnce(response(new Uint8Array([1, 2]).buffer))
      .mockResolvedValueOnce(response("missing", { status: 404 }))
      .mockResolvedValueOnce(
        response("", { headers: { "content-length": "2" } }),
      )
      .mockResolvedValueOnce(response("", { status: 404 }))
      .mockResolvedValueOnce(response({ success: true }));
    const result = await migrationWith(fetch).migrate(migrateInput);

    expect(result).toMatchObject({
      listed: 1,
      skipped: 1,
      uploaded: 0,
      failed: 0,
    });
  });

  it("retains the KV body when metadata-sidecar cleanup fails", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(listResponse(["attachment:attachments/a"]))
      .mockResolvedValueOnce(response(new Uint8Array([1]).buffer))
      .mockResolvedValueOnce(response("{}"))
      .mockResolvedValueOnce(
        response("", { headers: { "content-length": "1" } }),
      )
      .mockResolvedValueOnce(response("delete failed", { status: 500 }));

    const result = await migrationWith(fetch).migrate(migrateInput);

    expect(result).toMatchObject({ skipped: 1, failed: 1 });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(String(fetch.mock.calls[4][0])).toContain(
      "/values/attachment-meta%3Aattachments%2Fa",
    );
  });

  it("retains the KV body when metadata-sidecar reading fails", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(listResponse(["attachment:attachments/a"]))
      .mockResolvedValueOnce(response(new Uint8Array([1]).buffer))
      .mockResolvedValueOnce(response("read failed", { status: 500 }));

    const result = await migrationWith(fetch).migrate(migrateInput);

    expect(result).toMatchObject({
      listed: 1,
      uploaded: 0,
      skipped: 0,
      failed: 1,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("paginates KV listings and handles invalid sidecar JSON", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(listResponse([], "next"))
      .mockResolvedValueOnce(listResponse(["attachment:attachments/a"]))
      .mockResolvedValueOnce(response(new Uint8Array([1]).buffer))
      .mockResolvedValueOnce(response("not-json"))
      .mockResolvedValueOnce(
        response("", { headers: { "content-length": "1" } }),
      )
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response({ success: true }));
    const result = await migrationWith(fetch).migrate(migrateInput);

    expect(result).toMatchObject({ listed: 1, skipped: 1, failed: 0 });
    expect(String(fetch.mock.calls[0][0])).toContain("limit=1000");
    expect(String(fetch.mock.calls[1][0])).toContain("cursor=next");
  });

  it("reports KV listing and value read failures", async () => {
    const listing = migrationWith(
      vi.fn().mockResolvedValueOnce(response("bad gateway", { status: 502 })),
    );
    await expect(listing.migrate(migrateInput)).rejects.toMatchObject({
      event: "migration.kv_list_failed",
      exitCode: 8,
    });

    const events = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(listResponse(["attachment:attachments/a"]))
      .mockResolvedValueOnce(response("denied", { status: 403 }));
    const result = await migrationWith(fetch, vi.fn(), (event, fields) =>
      events.push({ event, ...fields }),
    ).migrate(migrateInput);
    expect(result.failed).toBe(1);
    expect(events[0]).toMatchObject({
      event: "migration.key_failed",
      key: "attachments/a",
      error: "Failed to read KV value attachment:attachments/a: 403",
    });
  });

  it("records non-Error object failures without aborting the migration", async () => {
    const events = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(listResponse(["attachment:attachments/a"]))
      .mockRejectedValueOnce("network gone");
    const result = await migrationWith(fetch, vi.fn(), (event, fields) =>
      events.push({ event, ...fields }),
    ).migrate(migrateInput);
    expect(result.failed).toBe(1);
    expect(events[0].error).toBe("network gone");
  });

  it.each([
    {
      name: "HEAD request",
      afterBody: [response("{}"), response("head denied", { status: 403 })],
    },
    {
      name: "PUT request",
      afterBody: [
        response("{}"),
        response("", { status: 404 }),
        response("put denied", { status: 403 }),
      ],
    },
    {
      name: "verification",
      afterBody: [
        response("{}"),
        response("", { status: 404 }),
        response({ success: true }),
        response("", { status: 404 }),
      ],
    },
    {
      name: "KV deletion",
      afterBody: [
        response("{}"),
        response("", { status: 404 }),
        response({ success: true }),
        response("", { headers: { "content-length": "1" } }),
        response("delete denied", { status: 403 }),
      ],
    },
  ])("records a failed $name", async ({ afterBody }) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(listResponse(["attachment:attachments/a"]))
      .mockResolvedValueOnce(response(new Uint8Array([1]).buffer));
    for (const item of afterBody) fetch.mockResolvedValueOnce(item);

    const result = await migrationWith(fetch).migrate(migrateInput);
    expect(result).toMatchObject({ listed: 1, failed: 1 });
  });

  it("rejects a mismatched post-upload verification size", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(listResponse(["attachment:attachments/a"]))
      .mockResolvedValueOnce(response(new Uint8Array([1]).buffer))
      .mockResolvedValueOnce(response("{}"))
      .mockResolvedValueOnce(response("", { status: 404 }))
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(
        response("", { headers: { "content-length": "2" } }),
      );
    const result = await migrationWith(fetch).migrate(migrateInput);
    expect(result).toMatchObject({ uploaded: 0, failed: 1 });
  });

  it("plans a size mismatch when HEAD omits content length", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(listResponse(["attachment:attachments/a"]))
      .mockResolvedValueOnce(response(new Uint8Array([1]).buffer))
      .mockResolvedValueOnce(response("{}"))
      .mockResolvedValueOnce(response(""));
    const result = await migrationWith(fetch).migrate({
      ...migrateInput,
      dryRun: true,
    });
    expect(result).toMatchObject({ planned: 1, bytesTotal: 1, failed: 0 });
  });

  it("exposes migration error fields for CLI handling", () => {
    const error = new AttachmentMigrationError("event", "message", 12, {
      detail: true,
    });
    expect(error).toMatchObject({
      name: "AttachmentMigrationError",
      message: "message",
      event: "event",
      exitCode: 12,
      fields: { detail: true },
    });
  });
});
