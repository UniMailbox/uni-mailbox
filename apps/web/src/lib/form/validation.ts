import type { ZodIssue } from "zod";

export interface ValidationToken {
  key: `errors:validation.${string}`;
  values: Record<string, string | number>;
}

function fieldLabelKey(issue: ZodIssue): string {
  return `fields.${issue.path.map(String).join(".") || "value"}`;
}

export function zodIssueToken(issue: ZodIssue): ValidationToken {
  const field = fieldLabelKey(issue);

  switch (issue.code) {
    case "too_small":
      return {
        key: "errors:validation.minLength",
        values: { field, min: Number(issue.minimum) },
      };
    case "too_big":
      return {
        key: "errors:validation.maxLength",
        values: { field, max: Number(issue.maximum) },
      };
    case "invalid_string":
      return issue.validation === "email"
        ? { key: "errors:validation.email", values: { field } }
        : { key: "errors:validation.invalidType", values: { field } };
    case "invalid_type":
      return issue.received === "undefined"
        ? { key: "errors:validation.required", values: { field } }
        : { key: "errors:validation.invalidType", values: { field } };
    default:
      return { key: "errors:validation.invalidType", values: { field } };
  }
}
