import type { RuntimeLocale } from "./locale";

export function formatDate(value: Date | number, locale: RuntimeLocale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(value);
}

export function formatNumber(value: number, locale: RuntimeLocale): string {
  return new Intl.NumberFormat(locale).format(value);
}
