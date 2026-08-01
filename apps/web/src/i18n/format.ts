import type { RuntimeLocale } from "./locale";

export function formatDate(
  value: Date | number,
  locale: RuntimeLocale,
  timeZone = "UTC",
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone,
  }).format(value);
}

export function formatDateTime(
  value: Date | number,
  locale: RuntimeLocale,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(value);
}

export function formatNumber(value: number, locale: RuntimeLocale): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatKibibytes(value: number, locale: RuntimeLocale): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "kilobyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value / 1024);
}

export function formatByteSize(value: number, locale: RuntimeLocale): string {
  if (value < 1024) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "byte",
      unitDisplay: "short",
    }).format(value);
  }
  return formatKibibytes(value, locale);
}

export function formatCount(value: number, locale: RuntimeLocale): string {
  if (locale === "zh-CN") return `${formatNumber(value, locale)} 项`;
  return `${formatNumber(value, locale)} ${value === 1 ? "item" : "items"}`;
}

export function parseTimestamp(value: string): Date | null {
  const normalized = value.replace(" ", "T");
  const date = new Date(
    /(?:z|[+-]\d{2}:\d{2})$/iu.test(normalized) ? normalized : `${normalized}Z`,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTimestamp(
  value: string,
  locale: RuntimeLocale,
  timeZone: string,
): string | null {
  const date = parseTimestamp(value);
  return date ? formatDateTime(date, locale, timeZone) : null;
}

export function formatRelativeDate(
  value: string,
  locale: RuntimeLocale,
  timeZone: string,
  now = new Date(),
): string | null {
  const date = parseTimestamp(value);
  if (!date) return null;
  const calendarDay = (candidate: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone,
    }).format(candidate);
  if (calendarDay(date) === calendarDay(now)) {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(date);
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}
