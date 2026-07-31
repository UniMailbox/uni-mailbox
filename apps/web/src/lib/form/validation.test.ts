import { z } from "zod";
import { describe, expect, it } from "vitest";
import { zodIssueToken } from "./validation";

describe("zodIssueToken", () => {
  it.each([
    [z.object({ email: z.string().min(4) }), "", "validation.minLength", { field: "fields.email", min: 4 }],
    [z.object({ email: z.string().max(8) }), "abcdefghi", "validation.maxLength", { field: "fields.email", max: 8 }],
    [z.object({ email: z.string().email() }), "not-an-email", "validation.email", { field: "fields.email" }],
    [z.object({ email: z.string() }), 42, "validation.invalidType", { field: "fields.email" }],
  ])(
    "maps a Zod issue for %p to a stable token",
    (schema, input, key, values) => {
      const issue = schema.safeParse({ email: input }).error?.issues[0];

      expect(zodIssueToken(issue!)).toEqual({ key: `errors:${key}`, values });
    },
  );
});
