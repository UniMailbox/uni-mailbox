import { describe, expect, it } from "vitest";
import { administrationEndpoints } from "../src/api";

const accountId = "account-1";
const zoneId = "zone-1";
const domainId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";

describe("current Worker settings endpoint contracts", () => {
  it("declares every Cloudflare and storage endpoint with the Worker method and path", () => {
    expect(administrationEndpoints.cloudflareStatus).toMatchObject({ method: "GET", path: "/admin/cloudflare/status" });
    expect(administrationEndpoints.cloudflareOauthStart).toMatchObject({ method: "POST", path: "/admin/cloudflare/oauth/start" });
    expect(administrationEndpoints.cloudflareOauthRevoke).toMatchObject({ method: "POST", path: "/admin/cloudflare/oauth/revoke" });
    expect(administrationEndpoints.cloudflareVerify).toMatchObject({ method: "POST", path: "/admin/cloudflare/verify" });
    expect(administrationEndpoints.cloudflareDomainCreate).toMatchObject({ method: "POST", path: "/admin/cloudflare/domains" });
    expect(administrationEndpoints.cloudflareInboundSmokeTest).toMatchObject({ method: "POST", path: "/admin/cloudflare/smoke-test/inbound" });
    expect(administrationEndpoints.cloudflareBrevoConnect).toMatchObject({ method: "POST", path: "/admin/cloudflare/brevo" });
    expect(administrationEndpoints.cloudflareOutboundSmokeTest).toMatchObject({ method: "POST", path: "/admin/cloudflare/smoke-test/outbound" });
    expect(administrationEndpoints.infrastructure).toMatchObject({ method: "GET", path: "/admin/infrastructure" });
    expect(administrationEndpoints.r2Verify).toMatchObject({ method: "POST", path: "/admin/storage/r2/verify" });
  });

  it("validates idempotency and exact Cloudflare request wire fields", () => {
    expect(administrationEndpoints.cloudflareVerify.request?.body?.parse({ accountId: ` ${accountId} `, zoneId: ` ${zoneId} `, mode: "dashboard" })).toEqual({ accountId, zoneId, mode: "dashboard" });
    expect(administrationEndpoints.cloudflareDomainCreate.request?.body?.parse({ name: " MAIL.EXAMPLE.COM " })).toEqual({ name: "mail.example.com" });
    expect(administrationEndpoints.cloudflareBrevoConnect.request?.body?.parse({ providerKey: "brevo", label: "Primary", apiKey: "12345678", webhookSecret: "abcdefgh", domainId })).toMatchObject({ providerKey: "brevo", domainId });
    expect(administrationEndpoints.cloudflareOutboundSmokeTest.request?.body?.parse({ connectionId, from: "OPS@example.com", to: "audit@example.com" })).toEqual({ connectionId, from: "ops@example.com", to: "audit@example.com" });
    expect(administrationEndpoints.r2Verify.request?.headers?.parse({ "idempotency-key": "request-1" })).toEqual({ "idempotency-key": "request-1" });
  });

  it("preserves checkpoint and infrastructure wire schemas, including an unrendered storage reason", () => {
    expect(administrationEndpoints.cloudflareStatus.responses[200].parse([{ checkpointKey: "cloudflare_mail", status: "failed", metadata: {}, errorCode: "CLOUDFLARE_API_FAILED", errorMessage: "provider-only diagnostic", verifiedAt: null }])[0]).toMatchObject({ checkpointKey: "cloudflare_mail", status: "failed", errorMessage: "provider-only diagnostic" });
    expect(administrationEndpoints.infrastructure.responses[200].parse({ required: { d1: "ok", kv: "ok", queue: "missing", assets: "error" }, attachments: { backend: "kv", r2: "missing", reason: "ATTACHMENTS binding is absent" } })).toMatchObject({ attachments: { backend: "kv", r2: "missing", reason: "ATTACHMENTS binding is absent" } });
    expect(administrationEndpoints.r2Verify.responses[200].parse({ status: "verified", backend: "r2" })).toEqual({ status: "verified", backend: "r2" });
  });
});
