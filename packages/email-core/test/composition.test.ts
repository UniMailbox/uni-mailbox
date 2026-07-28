import { describe, expect, it } from "vitest";
import {
  buildReplyHeaders,
  canonicalRequestHashInput,
  composeSignature,
  normalizeRecipients,
} from "../src";

describe("recipient normalization", () => {
  it("deduplicates within groups and applies TO then CC then BCC precedence", () => {
    expect(
      normalizeRecipients(
        ["A@example.com", "a@example.com", "to@example.com"],
        ["a@example.com", "CC@example.com", "cc@example.com"],
        ["to@example.com", "cc@example.com", "bcc@example.com"],
      ),
    ).toEqual({
      to: ["a@example.com", "to@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
    });
  });
});

describe("reply threading", () => {
  it("supports an empty parentReferences chain", () => {
    expect(
      buildReplyHeaders({
        parentMessageId: "<parent@example.com>",
      }),
    ).toEqual({
      inReplyTo: "<parent@example.com>",
      references: "<parent@example.com>",
    });
  });

  it("preserves order, removes duplicates, and appends the parent Message-ID", () => {
    expect(
      buildReplyHeaders({
        parentMessageId: "<parent@example.com>",
        parentReferences:
          "<root@example.com> <parent@example.com> <root@example.com>",
      }),
    ).toEqual({
      inReplyTo: "<parent@example.com>",
      references: "<root@example.com> <parent@example.com>",
    });
  });

  it("bounds References by dropping the oldest tokens", () => {
    const tokens = Array.from(
      { length: 40 },
      (_, index) => `<message-${index}@example.com>`,
    );
    const result = buildReplyHeaders({
      parentMessageId: "<parent@example.com>",
      parentReferences: tokens.join(" "),
      maximumLength: 120,
    });

    expect(result.references.length).toBeLessThanOrEqual(120);
    expect(result.references).toContain("<parent@example.com>");
    expect(result.references).not.toContain("<message-0@example.com>");
  });
});

describe("signature composition", () => {
  it("places a plain-text signature before quoted reply content", () => {
    expect(
      composeSignature({
        body: "Thanks!",
        signature: "UniMailbox Team",
        quoted: "> Previous message",
        format: "text",
      }),
    ).toBe("Thanks!\n\n-- \nUniMailbox Team\n\n> Previous message");
  });

  it("omits the separator when the signature is whitespace", () => {
    expect(
      composeSignature({
        body: "<p>Hello</p>",
        signature: "   \n",
        quoted: "<blockquote>Earlier</blockquote>",
        format: "html",
      }),
    ).toBe("<p>Hello</p><blockquote>Earlier</blockquote>");
  });

  it("does not add a separator for an empty signature", () => {
    expect(
      composeSignature({
        body: "<p>Hello</p>",
        signature: "",
        quoted: "<blockquote>Earlier</blockquote>",
        format: "html",
      }),
    ).toBe("<p>Hello</p><blockquote>Earlier</blockquote>");
  });

  it("returns body only when signature and quoted are both absent", () => {
    expect(
      composeSignature({
        body: "<p>Hello</p>",
        signature: "",
        format: "html",
      }),
    ).toBe("<p>Hello</p>");
  });

  it("places an HTML signature before quoted content", () => {
    expect(
      composeSignature({
        body: "<p>Thanks!</p>",
        signature: "<p>UniMailbox Team</p>",
        quoted: "<blockquote>Earlier</blockquote>",
        format: "html",
      }),
    ).toContain(
      '<div class="unimailbox-signature"><p>-- </p><p>UniMailbox Team</p></div><blockquote>Earlier</blockquote>',
    );
  });

  it("returns just the body when no quoted content is provided", () => {
    expect(
      composeSignature({
        body: "Just saying hi",
        signature: "UniMailbox Team",
        format: "text",
      }),
    ).toBe("Just saying hi\n\n-- \nUniMailbox Team");
  });

  it("composes an HTML signature without quoted content", () => {
    expect(
      composeSignature({
        body: "<p>Hi</p>",
        signature: "<p>UniMailbox Team</p>",
        format: "html",
      }),
    ).toBe(
      '<p>Hi</p><div class="unimailbox-signature"><p>-- </p><p>UniMailbox Team</p></div>',
    );
  });
});

describe("idempotency canonicalization", () => {
  it("sorts nested object keys without changing array order", () => {
    expect(
      canonicalRequestHashInput({
        z: [{ b: 2, a: 1 }],
        a: "first",
      }),
    ).toBe('{"a":"first","z":[{"a":1,"b":2}]}');
  });
});
