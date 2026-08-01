import { isErrorCode, type ErrorCode } from "@unimailbox/contracts";

export type ApiClientErrorCode =
  | ErrorCode
  | "UNKNOWN_SERVER_ERROR"
  | "CLIENT_RESPONSE_INVALID";

export class ApiClientError extends Error {
  readonly rawCode?: string;
  readonly params?: unknown;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly diagnosticMessage?: string;

  constructor(
    readonly code: ApiClientErrorCode,
    readonly status: number,
    options: {
      rawCode?: string;
      params?: unknown;
      details?: unknown;
      requestId?: string;
      diagnosticMessage?: string;
    } = {},
  ) {
    super(code);
    this.name = "ApiClientError";
    this.rawCode = options.rawCode;
    this.params = options.params;
    this.details = options.details;
    this.requestId = options.requestId;
    this.diagnosticMessage = options.diagnosticMessage;
  }
}

export function apiErrorCode(code: string): ApiClientErrorCode {
  return isErrorCode(code) ? code : "UNKNOWN_SERVER_ERROR";
}
