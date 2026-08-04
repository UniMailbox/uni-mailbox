import { describe, expect, it, vi } from "vitest";
import {
  enforceRateLimit,
  rateLimitWindowKey,
  rateLimitRules,
} from "../../src/platform/rate-limit";

function createMemoryKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, opts?: KVNamespacePutOptions) {
      store.set(key, value);
      void opts;
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
    async getWithMetadata() {
      return { value: null, metadata: null };
    },
  } as unknown as KVNamespace;
}

describe("enforceRateLimit", () => {
  it("increments within the same window without refreshing the TTL", async () => {
    const kv = createMemoryKV();
    const putSpy = vi.spyOn(kv, "put");
    const rule = rateLimitRules.messageSend;
    const now = new Date("2026-01-01T10:00:00Z").getTime();
    for (let i = 0; i < 3; i += 1) {
      await enforceRateLimit(kv, rule, "user-1", now);
    }
    expect(putSpy).toHaveBeenCalledTimes(3);
    const [key, , options] = putSpy.mock.calls[0]!;
    expect(key).toBe(rateLimitWindowKey(rule, "user-1", now));
    // TTL is anchored to the window, not to the request — a busy key must
    // not keep itself alive.
    expect(options).toEqual({
      expirationTtl: rule.windowSeconds + 60,
    });
  });

  it("rotates the key when the window advances", async () => {
    const kv = createMemoryKV();
    const rule = rateLimitRules.messageSend;
    const t0 = new Date("2026-01-01T10:00:00Z").getTime();
    const t1 = new Date("2026-01-01T10:01:00Z").getTime();
    await enforceRateLimit(kv, rule, "user-1", t0);
    await enforceRateLimit(kv, rule, "user-1", t1);
    const a = rateLimitWindowKey(rule, "user-1", t0);
    const b = rateLimitWindowKey(rule, "user-1", t1);
    expect(a).not.toBe(b);
    expect(await kv.get(a)).toBe("1");
    expect(await kv.get(b)).toBe("1");
  });

  it("stops writing once the quota is exhausted", async () => {
    const kv = createMemoryKV();
    const putSpy = vi.spyOn(kv, "put");
    const rule = { ...rateLimitRules.messageSend, limit: 2 };
    const now = Date.now();
    await enforceRateLimit(kv, rule, "user-1", now);
    await enforceRateLimit(kv, rule, "user-1", now);
    await expect(
      enforceRateLimit(kv, rule, "user-1", now),
    ).rejects.toMatchObject({ code: rule.code, status: 429 });
    // Two accepted writes, none after the limit was hit.
    expect(putSpy).toHaveBeenCalledTimes(2);
  });
});
