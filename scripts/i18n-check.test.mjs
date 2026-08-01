import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkI18nResources } from "./i18n-check.mjs";

async function withResources(resources, assertion) {
  const root = await mkdtemp(join(tmpdir(), "unimailbox-i18n-check-"));
  try {
    for (const [locale, namespaces] of Object.entries(resources)) {
      const directory = join(root, "apps/web/src/i18n/resources", locale);
      await mkdir(directory, { recursive: true });
      for (const [name, value] of Object.entries(namespaces)) {
        await writeFile(join(directory, `${name}.json`), JSON.stringify(value));
      }
    }
    await assertion(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

const requiredNamespaces = [
  "common",
  "auth",
  "mail",
  "settings",
  "admin",
  "errors",
];
const english = Object.fromEntries(
  requiredNamespaces.map((namespace) => [
    namespace,
    {
      greeting: "Hello {{name}}",
      inbox_one: "{{count}} message",
      inbox_other: "{{count}} messages",
    },
  ]),
);
const chinese = Object.fromEntries(
  requiredNamespaces.map((namespace) => [
    namespace,
    {
      greeting: "你好 {{name}}",
      inbox_one: "{{count}} 封邮件",
      inbox_other: "{{count}} 封邮件",
    },
  ]),
);

describe("i18n resource enforcement", () => {
  it("accepts identical production resources", async () => {
    await withResources({ en: english, "zh-CN": chinese }, async (root) =>
      expect(await checkI18nResources(root)).toEqual([]),
    );
  });

  it("rejects unequal leaf keys", async () => {
    await withResources(
      {
        en: english,
        "zh-CN": {
          ...chinese,
          common: { greeting: "你好 {{name}}", inbox_one: "{{count}} 封邮件" },
        },
      },
      async (root) =>
        expect(await checkI18nResources(root)).toContainEqual(
          expect.stringMatching(/common\.inbox_other/u),
        ),
    );
  });

  it("rejects unequal interpolation variables", async () => {
    await withResources(
      {
        en: english,
        "zh-CN": {
          ...chinese,
          common: {
            greeting: "你好 {{operator}}",
            inbox_one: "{{count}} 封邮件",
            inbox_other: "{{count}} 封邮件",
          },
        },
      },
      async (root) =>
        expect(await checkI18nResources(root)).toContainEqual(
          expect.stringMatching(/interpolation/u),
        ),
    );
  });

  it("rejects empty translation values", async () => {
    await withResources(
      {
        en: english,
        "zh-CN": {
          ...chinese,
          common: {
            greeting: "",
            inbox_one: "{{count}} 封邮件",
            inbox_other: "{{count}} 封邮件",
          },
        },
      },
      async (root) =>
        expect(await checkI18nResources(root)).toContainEqual(
          expect.stringMatching(/empty/u),
        ),
    );
  });

  it("rejects a missing required namespace", async () => {
    const withoutErrors = { ...chinese };
    delete withoutErrors.errors;
    await withResources({ en: english, "zh-CN": withoutErrors }, async (root) =>
      expect(await checkI18nResources(root)).toContainEqual(
        expect.stringMatching(/errors.*missing/u),
      ),
    );
  });

  it("rejects an extra production namespace", async () => {
    await withResources(
      {
        en: { ...english, experimental: { label: "Experimental" } },
        "zh-CN": { ...chinese, experimental: { label: "实验" } },
      },
      async (root) =>
        expect(await checkI18nResources(root)).toContainEqual(
          expect.stringMatching(
            /experimental.*not an allowed production namespace/u,
          ),
        ),
    );
  });

  it("rejects non-string translation leaves", async () => {
    await withResources(
      {
        en: { ...english, common: { ...english.common, greeting: 42 } },
        "zh-CN": chinese,
      },
      async (root) =>
        expect(await checkI18nResources(root)).toContainEqual(
          expect.stringMatching(/non-empty string/u),
        ),
    );
  });
});
