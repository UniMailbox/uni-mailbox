import { describe, expect, it } from "vitest";
import { findUnpinnedActions } from "./workflow-security-lib.mjs";

describe("workflow action pinning", () => {
  it("accepts local actions and full commit SHAs", () => {
    expect(
      findUnpinnedActions(`
steps:
  - uses: ./actions/local
  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
`),
    ).toEqual([]);
  });

  it("rejects tags, branches, and abbreviated SHAs", () => {
    expect(
      findUnpinnedActions(`
steps:
  - uses: actions/checkout@v4
  - uses: owner/action@main
  - uses: owner/action@1234abcd
`),
    ).toEqual([
      "actions/checkout@v4",
      "owner/action@main",
      "owner/action@1234abcd",
    ]);
  });
});
