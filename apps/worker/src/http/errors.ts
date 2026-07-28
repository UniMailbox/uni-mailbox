import { DomainError, type ApiErrorBody } from "@unimailbox/contracts";
import { ZodError } from "zod";

export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof DomainError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId,
        },
      } satisfies ApiErrorBody,
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "The request is invalid",
          details: error.flatten(),
          requestId,
        },
      } satisfies ApiErrorBody,
      { status: 400 },
    );
  }
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId,
      },
    } satisfies ApiErrorBody,
    { status: 500 },
  );
}
