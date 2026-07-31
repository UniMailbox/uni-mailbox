import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFrontendContracts } from "./frontend-contract-check.mjs";

async function withFrontend(files, assertion) {
  const root = await mkdtemp(join(tmpdir(), "unimailbox-contract-check-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(root, relativePath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, content);
    }
    await assertion(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe("frontend contract enforcement", () => {
  it("allows technical identifiers, paths, brand names, test data, and translated copy", async () => {
    await withFrontend(
      {
        "apps/web/src/features/Example.tsx": 'const path = "/api/v1/messages"; export function Example() { return <><a href={path}>UniMailbox</a><kbd>⌘ K</kbd></>; }',
        "apps/web/src/features/Example.test.tsx": 'export const fixture = <button>Save</button>;',
        "apps/web/src/styles.css": ".panel { margin-inline-start: 1rem; text-align: start; }",
        "packages/contracts/src/api/endpoints.ts": "export const endpoints = {};",
      },
      async (root) => expect(await checkFrontendContracts(root)).toEqual([]),
    );
  });

  it("rejects a visible production TSX literal", async () => {
    await withFrontend(
      { "apps/web/src/features/Example.tsx": "export const Example = () => <button>Save</button>;" },
      async (root) => expect(await checkFrontendContracts(root)).toContainEqual(expect.stringMatching(/visible product copy/u)),
    );
  });

  it("rejects legacy generic API calls and direct server message rendering", async () => {
    await withFrontend(
      { "apps/web/src/features/Example.tsx": "const value = apiRequest<Result>('/messages'); export const Example = ({ error }) => <p>{error.message}</p>;" },
      async (root) => {
        const errors = await checkFrontendContracts(root);
        expect(errors).toContainEqual(expect.stringMatching(/apiRequest/u));
        expect(errors).toContainEqual(expect.stringMatching(/error\.message/u));
      },
    );
  });

  it("rejects React Hook Form imports and physical CSS", async () => {
    await withFrontend(
      {
        "apps/web/src/features/Example.tsx": 'import { useForm } from "react-hook-form"; export const Example = () => null;',
        "apps/web/src/styles.css": ".panel { margin-left: 1rem; text-align: right; }",
      },
      async (root) => {
        const errors = await checkFrontendContracts(root);
        expect(errors).toContainEqual(expect.stringMatching(/react-hook-form/u));
        expect(errors).toContainEqual(expect.stringMatching(/physical CSS/u));
      },
    );
  });
});
