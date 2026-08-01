export const TIME_ZONE_STORAGE_KEY = "unimailbox.time-zone";

const FALLBACK_TIME_ZONES = [
  "UTC",
  "America/Chicago",
  "America/Los_Angeles",
  "America/New_York",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/London",
] as const;

export function isValidTimeZone(
  value: string | null | undefined,
): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function resolveInitialTimeZone(
  stored: string | null,
  detected = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  if (isValidTimeZone(stored)) return stored;
  if (isValidTimeZone(detected)) return detected;
  return "UTC";
}

export function supportedTimeZones(): string[] {
  const supportedValuesOf = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: "timeZone") => string[];
    }
  ).supportedValuesOf;
  const values = supportedValuesOf
    ? supportedValuesOf("timeZone")
    : [...FALLBACK_TIME_ZONES];
  return [...new Set(["UTC", ...values])].sort((left, right) =>
    left.localeCompare(right),
  );
}
