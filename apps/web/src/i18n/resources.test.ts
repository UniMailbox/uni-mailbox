import { ERROR_CODES } from "@unimailbox/contracts";
import { describe, expect, it } from "vitest";
import arAdmin from "./resources/ar-XB/admin.json";
import arAuth from "./resources/ar-XB/auth.json";
import arCommon from "./resources/ar-XB/common.json";
import arErrors from "./resources/ar-XB/errors.json";
import arMail from "./resources/ar-XB/mail.json";
import arSettings from "./resources/ar-XB/settings.json";
import enAdmin from "./resources/en/admin.json";
import enAuth from "./resources/en/auth.json";
import enCommon from "./resources/en/common.json";
import enErrors from "./resources/en/errors.json";
import enMail from "./resources/en/mail.json";
import enSettings from "./resources/en/settings.json";
import zhAdmin from "./resources/zh-CN/admin.json";
import zhAuth from "./resources/zh-CN/auth.json";
import zhCommon from "./resources/zh-CN/common.json";
import zhErrors from "./resources/zh-CN/errors.json";
import zhMail from "./resources/zh-CN/mail.json";
import zhSettings from "./resources/zh-CN/settings.json";

type ResourceValue = string | { readonly [key: string]: ResourceValue };
type FlatResource = Record<string, string>;

function flatten(value: ResourceValue, prefix = ""): FlatResource {
  return Object.entries(value).reduce<FlatResource>((flat, [key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") flat[path] = child;
    else Object.assign(flat, flatten(child, path));
    return flat;
  }, {});
}

function interpolationVariables(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/gu)]
    .map((match) => match[1])
    .sort();
}

const resources = {
  en: {
    admin: enAdmin,
    auth: enAuth,
    common: enCommon,
    errors: enErrors,
    mail: enMail,
    settings: enSettings,
  },
  "zh-CN": {
    admin: zhAdmin,
    auth: zhAuth,
    common: zhCommon,
    errors: zhErrors,
    mail: zhMail,
    settings: zhSettings,
  },
  "ar-XB": {
    admin: arAdmin,
    auth: arAuth,
    common: arCommon,
    errors: arErrors,
    mail: arMail,
    settings: arSettings,
  },
} as const;

describe("translation resources", () => {
  it("keeps every locale namespace, leaf key, interpolation, plural suffix, and value complete", () => {
    const english = Object.fromEntries(
      Object.entries(resources.en).map(([namespace, resource]) => [
        namespace,
        flatten(resource),
      ]),
    ) as Record<string, FlatResource>;

    for (const locale of ["zh-CN", "ar-XB"] as const) {
      expect(Object.keys(resources[locale]).sort()).toEqual(
        Object.keys(resources.en).sort(),
      );
      for (const namespace of Object.keys(english)) {
        const localized = flatten(
          resources[locale][namespace as keyof typeof resources.en],
        );
        expect(Object.keys(localized).sort()).toEqual(
          Object.keys(english[namespace]).sort(),
        );
        for (const key of Object.keys(english[namespace])) {
          expect(localized[key]).not.toBe("");
          expect(interpolationVariables(localized[key])).toEqual(
            interpolationVariables(english[namespace][key]),
          );
        }
      }
    }
    for (const resource of Object.values(english)) {
      expect(Object.values(resource)).not.toContain("");
    }
  });

  it("translates every stable API error in English and Chinese", () => {
    const englishErrors = flatten(enErrors);
    const chineseErrors = flatten(zhErrors);
    for (const code of ERROR_CODES) {
      expect(englishErrors[`api.${code}`]).toBeTruthy();
      expect(chineseErrors[`api.${code}`]).toBeTruthy();
    }
  });
});
