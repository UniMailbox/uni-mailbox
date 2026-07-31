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

const english = {
  common: {
    greeting: "Hello {{name}}",
    inbox_one: "{{count}} message",
    inbox_other: "{{count}} messages",
  },
};

describe("i18n resource enforcement", () => {
  it("accepts identical production resources", async () => {
    await withResources(
      { en: english, "zh-CN": { common: { greeting: "你好 {{name}}", inbox_one: "{{count}} 封邮件", inbox_other: "{{count}} 封邮件" } } },
      async (root) => expect(await checkI18nResources(root)).toEqual([]),
    );
  });

  it("rejects unequal leaf keys", async () => {
    await withResources(
      { en: english, "zh-CN": { common: { greeting: "你好 {{name}}", inbox_one: "{{count}} 封邮件" } } },
      async (root) => expect(await checkI18nResources(root)).toContainEqual(expect.stringMatching(/common\.inbox_other/u)),
    );
  });

  it("rejects unequal interpolation variables", async () => {
    await withResources(
      { en: english, "zh-CN": { common: { greeting: "你好 {{operator}}", inbox_one: "{{count}} 封邮件", inbox_other: "{{count}} 封邮件" } } },
      async (root) => expect(await checkI18nResources(root)).toContainEqual(expect.stringMatching(/interpolation/u)),
    );
  });

  it("rejects empty translation values", async () => {
    await withResources(
      { en: english, "zh-CN": { common: { greeting: "", inbox_one: "{{count}} 封邮件", inbox_other: "{{count}} 封邮件" } } },
      async (root) => expect(await checkI18nResources(root)).toContainEqual(expect.stringMatching(/empty/u)),
    );
  });
});
