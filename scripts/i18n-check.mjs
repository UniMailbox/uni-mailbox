import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const productionLocales = ["en", "zh-CN"];
const requiredNamespaces = ["common", "auth", "mail", "settings", "admin", "errors"];
const pluralSuffixes = new Set(["zero", "one", "two", "few", "many", "other"]);

async function jsonFiles(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}

function lineFor(content, key) {
  const index = content.indexOf(`"${key}"`);
  return index === -1 ? 1 : content.slice(0, index).split("\n").length;
}

function flatten(value, file, content, prefix = "", output = new Map()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    output.set(prefix, { file, line: 1, value });
    return output;
  }
  if (Object.keys(value).length === 0) {
    output.set(prefix, { file, line: 1, value });
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      output.set(path, { file, line: lineFor(content, key), value: child });
    } else {
      flatten(child, file, content, path, output);
    }
  }
  return output;
}

function interpolationVariables(value) {
  return [...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/gu)]
    .map((match) => match[1])
    .sort();
}

function pluralSets(resource) {
  const sets = new Map();
  for (const key of resource.keys()) {
    const match = /^(.*)_([a-z]+)$/u.exec(key);
    if (!match || !pluralSuffixes.has(match[2])) continue;
    const suffixes = sets.get(match[1]) ?? new Set();
    suffixes.add(match[2]);
    sets.set(match[1], suffixes);
  }
  return sets;
}

function format(root, file, line, message) {
  return `${relative(root, file)}:${line}: ${message}`;
}

/** Returns all English/Chinese translation integrity failures without mutating files. */
export async function checkI18nResources(root = process.cwd()) {
  const resourceRoot = resolve(root, "apps/web/src/i18n/resources");
  const errors = [];
  const namespaces = new Map();

  for (const locale of productionLocales) {
    const directory = resolve(resourceRoot, locale);
    const files = await jsonFiles(directory);
    namespaces.set(locale, new Map());
    for (const filename of files) {
      const file = resolve(directory, filename);
      const content = await readFile(file, "utf8");
      try {
        namespaces.get(locale).set(filename.slice(0, -".json".length), {
          file,
          flat: flatten(JSON.parse(content), file, content),
        });
      } catch (error) {
        errors.push(format(root, file, 1, `invalid JSON: ${error.message}`));
      }
    }
  }

  const english = namespaces.get("en");
  const chinese = namespaces.get("zh-CN");
  const allNamespaces = new Set([...requiredNamespaces, ...english.keys(), ...chinese.keys()]);
  for (const namespace of [...allNamespaces].sort()) {
    const en = english.get(namespace);
    const zh = chinese.get(namespace);
    if (!en || !zh) {
      const existing = en ?? zh;
      errors.push(format(root, existing.file, 1, `namespace ${namespace} is missing from ${en ? "zh-CN" : "en"}`));
      continue;
    }

    const keys = new Set([...en.flat.keys(), ...zh.flat.keys()]);
    for (const key of [...keys].sort()) {
      const enValue = en.flat.get(key);
      const zhValue = zh.flat.get(key);
      if (!enValue || !zhValue) {
        const existing = enValue ?? zhValue;
        errors.push(format(root, existing.file, existing.line, `${namespace}.${key} is missing from ${enValue ? "zh-CN" : "en"}`));
        continue;
      }
      for (const value of [enValue, zhValue]) {
        if (typeof value.value !== "string" || value.value.trim() === "") {
          errors.push(format(root, value.file, value.line, `${namespace}.${key} must be a non-empty string translation value`));
        }
      }
      if (typeof enValue.value === "string" && typeof zhValue.value === "string" && JSON.stringify(interpolationVariables(enValue.value)) !== JSON.stringify(interpolationVariables(zhValue.value))) {
        errors.push(format(root, zhValue.file, zhValue.line, `${namespace}.${key} has unequal interpolation variables`));
      }
    }

    const pluralBases = new Set([...pluralSets(en.flat).keys(), ...pluralSets(zh.flat).keys()]);
    for (const base of [...pluralBases].sort()) {
      const enSuffixes = [...(pluralSets(en.flat).get(base) ?? new Set())].sort();
      const zhSuffixes = [...(pluralSets(zh.flat).get(base) ?? new Set())].sort();
      if (JSON.stringify(enSuffixes) !== JSON.stringify(zhSuffixes)) {
        errors.push(format(root, zh.file, 1, `${namespace}.${base} has unequal plural suffixes`));
      }
    }
  }
  return errors;
}

async function main() {
  const errors = await checkI18nResources();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("i18n resource parity passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
