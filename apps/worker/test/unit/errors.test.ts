import { describe, expect, it } from "vitest";
import { DomainError } from "@unimailbox/contracts";
import { errorResponse } from "../../src/http/errors";

describe("errorResponse", () => {
  it("formats a DomainError with details", async () => {
    const error = new DomainError("CODE", "Bad input", 422, { field: "x" });
    const response = errorResponse(error, "req-1");
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "CODE",
        message: "Bad input",
        details: { field: "x" },
        requestId: "req-1",
      },
    });
  });

  it("formats a DomainError without details", async () => {
    const error = new DomainError("CODE", "Bad input", 422);
    const response = errorResponse(error, "req-1");
    const body = (await response.json()) as {
      error: { details?: unknown; code: string };
    };
    expect(body.error.details).toBeUndefined();
  });

  it("translates a ZodError to a 400 VALIDATION_FAILED response", async () => {
    let captured: unknown;
    try {
      const schema = await import("zod").then(({ z }) =>
        z.object({ value: z.string() }),
      );
      schema.parse({ value: 1 });
    } catch (error) {
      captured = error;
    }
    const response = errorResponse(captured, "req-zod");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED", requestId: "req-zod" },
    });
  });

  it("falls back to a generic 500 for unknown errors", async () => {
    const response = errorResponse(new Error("boom"), "req-x");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INTERNAL_ERROR", requestId: "req-x" },
    });
  });
});