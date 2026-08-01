export const LOCALE_STORAGE_KEY = "unimailbox.locale";

export const localeMetadata = {
  en: { languageTag: "en", direction: "ltr" },
  "zh-CN": { languageTag: "zh-CN", direction: "ltr" },
  "ar-XB": { languageTag: "ar-XB", direction: "rtl", testOnly: true },
} as const;

export type RuntimeLocale = keyof typeof localeMetadata;
export type SupportedLocale = Exclude<RuntimeLocale, "ar-XB">;

export function resolveInitialLocale(
  stored: string | null,
  languages: readonly string[],
  allowTestLocale = false,
): RuntimeLocale {
  if (stored === "en" || stored === "zh-CN") return stored;
  if (stored === "ar-XB" && allowTestLocale) return stored;

  return languages.some((language) => /^zh(?:-|$)/iu.test(language))
    ? "zh-CN"
    : "en";
}
