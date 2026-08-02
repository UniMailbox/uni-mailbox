import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  ApiErrorEnvelopeSchema,
  ApiSuccessEnvelopeSchema,
  CursorPageSchema,
  defineEndpoint,
  isErrorCode,
  type EndpointRequest,
  type EndpointResponse,
} from "../src/api";

const login = defineEndpoint({
  method: "POST",
  path: "/auth/login",
  request: { body: z.object({ email: z.string().email() }) },
  responses: { 200: z.object({ accessToken: z.string() }) },
  errors: ["AUTH_REQUIRED"],
  mediaType: "json",
});

describe("endpoint contracts", () => {
  it("preserves endpoint literals and parses compatible error envelopes", () => {
    expect(login.method).toBe("POST");
    expect(login.path).toBe("/auth/login");
    expect(
      ApiErrorEnvelopeSchema.parse({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required",
          requestId: "request-1",
          details: { legacy: true },
          params: { destination: "login" },
        },
      }),
    ).toMatchObject({
      error: {
        code: "AUTH_REQUIRED",
        requestId: "request-1",
        details: { legacy: true },
        params: { destination: "login" },
      },
    });
  });

  it("builds shared success, pagination, and error-code contracts", () => {
    expect(
      ApiSuccessEnvelopeSchema(z.object({ id: z.string() })).parse({
        data: { id: "message-1" },
      }),
    ).toEqual({ data: { id: "message-1" } });
    expect(
      CursorPageSchema(z.string()).parse({
        items: ["message-1"],
        nextCursor: null,
      }),
    ).toEqual({ items: ["message-1"], nextCursor: null });
    expect(isErrorCode("AUTH_REQUIRED")).toBe(true);
    expect(isErrorCode("NOT_A_REAL_ERROR")).toBe(false);
  });

  it("infers request and response values from schemas", () => {
    expectTypeOf<EndpointRequest<typeof login>>().toEqualTypeOf<{
      body: { email: string };
    }>();
    expectTypeOf<EndpointResponse<typeof login, 200>>().toEqualTypeOf<{
      accessToken: string;
    }>();

    const request: EndpointRequest<typeof login> = {
      body: { email: "person@example.com" },
    };
    expect(request.body.email).toBe("person@example.com");

    // @ts-expect-error email is required by the login body schema
    const invalidRequest: EndpointRequest<typeof login> = { body: {} };
    expect(invalidRequest).toBeDefined();

    // @ts-expect-error login does not declare a 201 response
    type UnsupportedStatus = EndpointResponse<typeof login, 201>;
    const unsupportedStatus: UnsupportedStatus = undefined;
    expect(unsupportedStatus).toBeUndefined();
  });
});
