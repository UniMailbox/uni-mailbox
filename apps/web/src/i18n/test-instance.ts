import { createI18nInstance } from "./index";
import type { RuntimeLocale } from "./locale";
import arXBCommon from "./resources/ar-XB/common.json";

export function createTestI18n(locale: RuntimeLocale) {
  return createI18nInstance(locale, arXBCommon);
}
