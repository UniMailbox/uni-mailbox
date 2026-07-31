import i18next, { type i18n, type Resource } from "i18next";
import enCommon from "./resources/en/common.json";
import enErrors from "./resources/en/errors.json";
import enAuth from "./resources/en/auth.json";
import enMail from "./resources/en/mail.json";
import enSettings from "./resources/en/settings.json";
import enAdmin from "./resources/en/admin.json";
import zhCNCommon from "./resources/zh-CN/common.json";
import zhCNErrors from "./resources/zh-CN/errors.json";
import zhCNAuth from "./resources/zh-CN/auth.json";
import zhCNMail from "./resources/zh-CN/mail.json";
import zhCNSettings from "./resources/zh-CN/settings.json";
import zhCNAdmin from "./resources/zh-CN/admin.json";
import arXBErrors from "./resources/ar-XB/errors.json";
import arXBAuth from "./resources/ar-XB/auth.json";
import arXBMail from "./resources/ar-XB/mail.json";
import arXBSettings from "./resources/ar-XB/settings.json";
import arXBAdmin from "./resources/ar-XB/admin.json";
import {
  LOCALE_STORAGE_KEY,
  localeMetadata,
  resolveInitialLocale,
  type RuntimeLocale,
} from "./locale";

const productionResources = {
  en: { common: enCommon, errors: enErrors, auth: enAuth, mail: enMail, settings: enSettings, admin: enAdmin },
  "zh-CN": { common: zhCNCommon, errors: zhCNErrors, auth: zhCNAuth, mail: zhCNMail, settings: zhCNSettings, admin: zhCNAdmin },
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
    ? { ...productionResources, "ar-XB": { common: testResources, errors: arXBErrors, auth: arXBAuth, mail: arXBMail, settings: arXBSettings, admin: arXBAdmin } }
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
    ns: ["common", "errors", "auth", "mail", "settings", "admin"],
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
