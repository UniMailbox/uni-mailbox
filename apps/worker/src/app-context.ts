import { BREVO_PROVIDER_KEY } from "@unimailbox/contracts";
import { createBrevoProviderPlugin } from "./integrations/brevo";
import { ProviderRegistry } from "./integrations/providers";
import type { HttpAppContext } from "./http/router";
import { TokenService } from "./modules/identity";
import { IdentityApplicationService } from "./modules/identity/application";
import { InstallationService } from "./modules/installation";
import { D1InstallationRepository } from "./modules/installation/infrastructure/d1-installation.repository";
import { HealthService } from "./modules/maintenance";
import { MailboxApplicationService } from "./modules/mailboxes";
import { CursorCodec } from "./modules/messages/cursor";
import { MessageApplicationService } from "./modules/messages";
import { DraftApplicationService } from "./modules/messages/drafts";
import { AttachmentApplicationService } from "./modules/attachments";
import { UploadTokenCodec } from "./modules/attachments/upload-token";
import { WebhookApplicationService } from "./modules/provider-sync/webhook";
import { AdminApplicationService } from "./modules/administration";
import { CloudflareSettingsService } from "./modules/administration/cloudflare-settings";
import { InfrastructureSettingsService } from "./modules/administration/infrastructure-settings";
import { resolveRuntimeConfig, type Env } from "./platform/config";
import { CredentialCipher } from "./platform/crypto";
import { StructuredLogger } from "./platform/logger";
import {
  createAttachmentStore,
  detectStorageBackend,
  type AttachmentStore,
  type StorageBackend,
} from "./platform/attachment-store";

export interface AppContext extends HttpAppContext {
  env: Env;
  providers: ProviderRegistry;
  credentials: CredentialCipher;
  attachmentStore: AttachmentStore;
  storageBackend: StorageBackend;
}

export async function createAppContext(
  env: Env,
  _executionContext?: ExecutionContext,
): Promise<AppContext> {
  const runtime = await resolveRuntimeConfig(env);
  const installation = new InstallationService(
    new D1InstallationRepository(env.DB),
  );
  const attachmentStore = createAttachmentStore(env);
  const storageBackend = detectStorageBackend(env).backend;
  const health = new HealthService(env, storageBackend);
  const tokens = new TokenService(runtime.AUTH_SIGNING_KEY);
  const identity = new IdentityApplicationService(env, tokens);
  const mailboxes = new MailboxApplicationService(env);
  const partialContext = {
    env,
    providers: new ProviderRegistry(
      new Map([[BREVO_PROVIDER_KEY, createBrevoProviderPlugin()]]),
    ),
    credentials: new CredentialCipher(runtime.CREDENTIAL_ENCRYPTION_KEY),
    logger: new StructuredLogger(),
    attachmentStore,
    storageBackend,
  };
  const messages = new MessageApplicationService(
    partialContext,
    mailboxes,
    new CursorCodec(runtime.AUTH_SIGNING_KEY),
  );
  const attachments = new AttachmentApplicationService(
    env,
    new UploadTokenCodec(runtime.AUTH_SIGNING_KEY),
    attachmentStore,
  );
  const drafts = new DraftApplicationService(partialContext, mailboxes);
  const webhooks = new WebhookApplicationService(partialContext);
  const admin = new AdminApplicationService(partialContext);
  return {
    ...partialContext,
    installation,
    health,
    settings: new CloudflareSettingsService(
      env.KV,
      env.DB,
      partialContext.credentials,
      partialContext.providers,
      {
        clientId: env.CLOUDFLARE_OAUTH_CLIENT_ID,
        clientSecret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET,
        scopes: env.CLOUDFLARE_OAUTH_SCOPES,
      },
    ),
    infrastructure: new InfrastructureSettingsService(env, health),
    auth: {
      verifyAccessToken: (token) => identity.verifyAccessToken(token),
    },
    identity,
    mailboxes,
    messages,
    attachments,
    drafts,
    webhooks,
    admin,
  };
}
