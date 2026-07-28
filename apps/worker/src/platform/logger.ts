export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const forbiddenKeys = /body|content|credential|password|secret|token|bytes/iu;

function safeFields(fields: LogFields = {}): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      forbiddenKeys.test(key) ? "[REDACTED]" : value,
    ]),
  );
}

export class StructuredLogger implements Logger {
  constructor(private readonly base: LogFields = {}) {}

  info(event: string, fields?: LogFields): void {
    this.write("info", event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    this.write("warn", event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.write("error", event, fields);
  }

  private write(
    level: "info" | "warn" | "error",
    event: string,
    fields?: LogFields,
  ): void {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        ...safeFields(this.base),
        ...safeFields(fields),
      }),
    );
  }
}
