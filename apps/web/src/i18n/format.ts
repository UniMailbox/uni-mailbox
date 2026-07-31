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

export function formatRelativeDate(
  value: string,
  locale: RuntimeLocale,
  now = new Date(),
): string | null {
  const date = new Date(
    value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"),
  );
  if (Number.isNaN(date.getTime())) return null;
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(date);
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
