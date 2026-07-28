export interface NormalizedRecipients {
  to: string[];
  cc: string[];
  bcc: string[];
}

function normalizeGroup(values: readonly string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
    ),
  ];
}

export function normalizeRecipients(
  to: readonly string[],
  cc: readonly string[] = [],
  bcc: readonly string[] = [],
): NormalizedRecipients {
  const normalizedTo = normalizeGroup(to);
  const toSet = new Set(normalizedTo);
  const normalizedCc = normalizeGroup(cc).filter(
    (address) => !toSet.has(address),
  );
  const ccSet = new Set(normalizedCc);
  const normalizedBcc = normalizeGroup(bcc).filter(
    (address) => !toSet.has(address) && !ccSet.has(address),
  );

  return {
    to: normalizedTo,
    cc: normalizedCc,
    bcc: normalizedBcc,
  };
}

export interface ReplyHeaderInput {
  parentMessageId: string;
  parentReferences?: string;
  maximumLength?: number;
}

export function buildReplyHeaders(input: ReplyHeaderInput): {
  inReplyTo: string;
  references: string;
} {
  const maximumLength = input.maximumLength ?? 998;
  const ordered = [
    ...new Set(
      `${input.parentReferences ?? ""} ${input.parentMessageId}`
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  ];

  while (ordered.join(" ").length > maximumLength && ordered.length > 1) {
    ordered.shift();
  }

  return {
    inReplyTo: input.parentMessageId,
    references: ordered.join(" "),
  };
}

export function composeSignature(input: {
  body: string;
  signature: string;
  quoted?: string;
  format: "html" | "text";
}): string {
  if (!input.signature.trim()) {
    return `${input.body}${input.quoted ?? ""}`;
  }

  if (input.format === "html") {
    const quoted = input.quoted ?? "";
    return `${input.body}<div class="unimailbox-signature"><p>-- </p>${input.signature}</div>${quoted}`;
  }

  const quoted = input.quoted ? `\n\n${input.quoted}` : "";
  return `${input.body}\n\n-- \n${input.signature}${quoted}`;
}

export function canonicalRequestHashInput(input: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(normalize);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return value;
  };

  return JSON.stringify(normalize(input));
}
