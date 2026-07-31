import i18next, { type i18n, type Resource } from "i18next";
import enCommon from "./resources/en/common.json";
import enErrors from "./resources/en/errors.json";
import enAuth from "./resources/en/auth.json";
import enMail from "./resources/en/mail.json";
import enSettings from "./resources/en/settings.json";
import zhCNCommon from "./resources/zh-CN/common.json";
import zhCNErrors from "./resources/zh-CN/errors.json";
import zhCNAuth from "./resources/zh-CN/auth.json";
import zhCNMail from "./resources/zh-CN/mail.json";
import zhCNSettings from "./resources/zh-CN/settings.json";
import arXBErrors from "./resources/ar-XB/errors.json";
import arXBAuth from "./resources/ar-XB/auth.json";
import arXBMail from "./resources/ar-XB/mail.json";
import arXBSettings from "./resources/ar-XB/settings.json";
import {
  LOCALE_STORAGE_KEY,
  localeMetadata,
  resolveInitialLocale,
  type RuntimeLocale,
} from "./locale";

const settingsErrors = {
  en: {
    CLOUDFLARE_API_FAILED: "Cloudflare could not complete this request.",
    CLOUDFLARE_CATCH_ALL_CONFLICT: "Cloudflare Email Routing has a conflicting catch-all rule.",
    CLOUDFLARE_OAUTH_CALLBACK_INVALID: "The Cloudflare authorization response is invalid or expired.",
    CLOUDFLARE_OAUTH_EXCHANGE_FAILED: "Cloudflare could not complete authorization.",
    CLOUDFLARE_OAUTH_HTTPS_REQUIRED: "Cloudflare OAuth requires HTTPS.",
    CLOUDFLARE_OAUTH_NOT_CONFIGURED: "Cloudflare OAuth is not configured.",
    CLOUDFLARE_OAUTH_ORIGIN_INVALID: "The Cloudflare authorization origin is invalid.",
    CLOUDFLARE_OAUTH_REFRESH_FAILED: "Cloudflare authorization could not be refreshed.",
    CLOUDFLARE_OAUTH_REVOKE_FAILED: "Cloudflare authorization could not be revoked.",
    CLOUDFLARE_ZONE_ACCOUNT_MISMATCH: "The selected zone does not belong to this account.",
    DOMAIN_CONFLICT: "This managed domain already exists.", DOMAIN_ZONE_MISMATCH: "The managed domain is outside the selected Cloudflare zone.",
    INBOUND_SMOKE_TOKEN_INVALID: "The inbound test token is invalid or expired.", PROVIDER_CONNECTION_NOT_FOUND: "Provider connection not found.",
    PROVIDER_NOT_SUPPORTED: "This provider is not supported.", R2_NOT_CONFIGURED: "R2 storage is not configured.", R2_VERIFICATION_FAILED: "R2 storage could not be verified.",
  },
  "zh-CN": {
    CLOUDFLARE_API_FAILED: "Cloudflare 无法完成此请求。", CLOUDFLARE_CATCH_ALL_CONFLICT: "Cloudflare Email Routing 存在冲突的全部捕获规则。",
    CLOUDFLARE_OAUTH_CALLBACK_INVALID: "Cloudflare 授权响应无效或已过期。", CLOUDFLARE_OAUTH_EXCHANGE_FAILED: "Cloudflare 无法完成授权。",
    CLOUDFLARE_OAUTH_HTTPS_REQUIRED: "Cloudflare OAuth 需要 HTTPS。", CLOUDFLARE_OAUTH_NOT_CONFIGURED: "尚未配置 Cloudflare OAuth。",
    CLOUDFLARE_OAUTH_ORIGIN_INVALID: "Cloudflare 授权来源无效。", CLOUDFLARE_OAUTH_REFRESH_FAILED: "无法刷新 Cloudflare 授权。",
    CLOUDFLARE_OAUTH_REVOKE_FAILED: "无法撤销 Cloudflare 授权。", CLOUDFLARE_ZONE_ACCOUNT_MISMATCH: "所选区域不属于此账户。",
    DOMAIN_CONFLICT: "此受管域名已存在。", DOMAIN_ZONE_MISMATCH: "受管域名不在所选 Cloudflare 区域中。",
    INBOUND_SMOKE_TOKEN_INVALID: "入站测试令牌无效或已过期。", PROVIDER_CONNECTION_NOT_FOUND: "未找到提供商连接。",
    PROVIDER_NOT_SUPPORTED: "不支持此提供商。", R2_NOT_CONFIGURED: "尚未配置 R2 存储。", R2_VERIFICATION_FAILED: "无法验证 R2 存储。",
  },
} as const;

const productionResources = {
  en: { common: enCommon, errors: { ...enErrors, api: { ...enErrors.api, ...settingsErrors.en } }, auth: enAuth, mail: enMail, settings: enSettings },
  "zh-CN": { common: zhCNCommon, errors: { ...zhCNErrors, api: { ...zhCNErrors.api, ...settingsErrors["zh-CN"] } }, auth: zhCNAuth, mail: zhCNMail, settings: zhCNSettings },
};

function synchronizeDocument(instance: i18n, locale: RuntimeLocale): void {
  const metadata = localeMetadata[locale];
  document.documentElement.lang = metadata.languageTag;
  document.documentElement.dir = metadata.direction;
  document.title = instance.t("meta.title");

  const description = document.querySelector('meta[name="description"]');
  description?.setAttribute("content", instance.t("meta.description"));

  if (locale !== "ar-XB") {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
}

export function createI18nInstance(
  locale: RuntimeLocale,
  testResources?: Resource,
): i18n {
  const resources = testResources
    ? { ...productionResources, "ar-XB": { common: testResources, errors: arXBErrors, auth: arXBAuth, mail: arXBMail, settings: arXBSettings } }
    : productionResources;
  const instance = i18next.createInstance();

  instance.on("languageChanged", (language) => {
    if (language in localeMetadata) {
      synchronizeDocument(instance, language as RuntimeLocale);
    }
  });
  void instance.init({
    resources,
    lng: locale,
    fallbackLng: false,
    defaultNS: "common",
    ns: ["common", "errors", "auth", "mail", "settings"],
    initImmediate: false,
    showSupportNotice: false,
  });

  synchronizeDocument(instance, locale);
  return instance;
}

export async function initializeI18n(): Promise<i18n> {
  const allowTestLocale = import.meta.env.DEV || import.meta.env.MODE === "test";
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  const locale = resolveInitialLocale(stored, navigator.languages, allowTestLocale);
  const testResources = allowTestLocale
    ? (await import("./resources/ar-XB/common.json")).default
    : undefined;

  return createI18nInstance(locale, testResources);
}

export { LOCALE_STORAGE_KEY, localeMetadata, resolveInitialLocale } from "./locale";
export type { RuntimeLocale, SupportedLocale } from "./locale";
