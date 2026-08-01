import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const TECHNICAL_VISIBLE_VALUES = new Set(["CM", "OP", "UniMailbox"]);
// The transport is the one approved owner of fetch for endpoint contracts.
const API_TRANSPORT_FILE = "apps/web/src/lib/api/transport.ts";
const CONTRACTS_API_DIRECTORY = "packages/contracts/src/api";

async function walk(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      }),
    );
    return nested.flat();
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT")
      return [];
    throw error;
  }
}

function lineFor(content, index) {
  return content.slice(0, index).split("\n").length;
}

function format(root, file, content, index, message) {
  return `${relative(root, file)}:${lineFor(content, index)}: ${message}`;
}

function isProductionSource(file) {
  return (
    SOURCE_EXTENSIONS.has(file.slice(file.lastIndexOf("."))) &&
    !/\.test\.[cm]?[jt]sx?$/u.test(file) &&
    !/\/test\//u.test(file)
  );
}

function isTechnicalValue(value) {
  return (
    TECHNICAL_VISIBLE_VALUES.has(value) ||
    /^(?:⌘|Ctrl|Alt|Shift|⌥|⌃)\s*[A-Za-z0-9]/u.test(value) ||
    /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/u.test(value) ||
    /^(?:https?:\/\/|\/|[\w.-]+\.[A-Za-z]{2,})/u.test(value) ||
    /^[\w.-]+(?:\/[\w.-]+)+$/u.test(value)
  );
}

function visibleLiterals(content) {
  const results = [];
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, "");
  for (const match of withoutComments.matchAll(
    /<[A-Za-z][\w.-]*(?:\s[^<>]*)?>\s*([^<>{}\n][^<>{}]*?)\s*<\//gu,
  )) {
    const value = match[1].replace(/\s+/gu, " ").trim();
    if (value && /[\p{L}\p{N}]/u.test(value) && !isTechnicalValue(value)) {
      results.push({ index: match.index, value });
    }
  }
  for (const match of withoutComments.matchAll(
    /\b(?:aria-label|placeholder|title|alt)\s*=\s*["']([^"']+)["']/gu,
  )) {
    const value = match[1].trim();
    if (value && !isTechnicalValue(value))
      results.push({ index: match.index, value });
  }
  return results;
}

function patternFailures(root, file, content, pattern, message, errors) {
  for (const match of content.matchAll(pattern)) {
    errors.push(format(root, file, content, match.index, message));
  }
}

function rawFormFailures(content) {
  const forms = [];
  for (const match of content.matchAll(/<form(?!\.)\b/gu)) {
    const end = content.indexOf("</form>", match.index);
    const markup = content.slice(
      match.index,
      end === -1 ? content.length : end + "</form>".length,
    );
    const owner = /\b([A-Za-z_$][\w$]*)\.handleSubmit\b/u.exec(markup)?.[1];
    const isAppForm =
      Boolean(owner) &&
      markup.includes("onSubmit") &&
      (markup.includes(`<${owner}.AppField`) ||
        markup.includes(`<${owner}.AppForm`) ||
        markup.includes(`<${owner}.Subscribe`));
    if (!isAppForm) forms.push(match.index);
  }
  return forms;
}

/**
 * Validates frontend-only invariants that TypeScript cannot express: no visible
 * untranslated copy, no physical directional CSS, no React Hook Form, and no
 * uncontracted API call. The transport is the sole owner of fetch.
 */
export async function checkFrontendContracts(root = process.cwd()) {
  const errors = [];
  const sourceRoot = resolve(root, "apps/web/src");
  const files = (await walk(sourceRoot)).filter(isProductionSource).sort();
  const usedEndpointOperations = new Map();

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const fileName = relative(root, file);
    if (fileName.endsWith(".tsx")) {
      for (const literal of visibleLiterals(content)) {
        errors.push(
          format(
            root,
            file,
            content,
            literal.index,
            `visible product copy must use i18n: ${JSON.stringify(literal.value)}`,
          ),
        );
      }
    }
    patternFailures(
      root,
      file,
      content,
      /\bapiRequest\s*</gu,
      "legacy apiRequest<T> is not an endpoint contract",
      errors,
    );
    patternFailures(
      root,
      file,
      content,
      /\bapiResponse\s*\(/gu,
      "raw apiResponse() is not an endpoint contract",
      errors,
    );
    patternFailures(
      root,
      file,
      content,
      /\berror\.message\b/gu,
      "error.message must not be rendered as product copy",
      errors,
    );
    patternFailures(
      root,
      file,
      content,
      /(?:from\s+["']react-hook-form["']|require\(["']react-hook-form["']\))/gu,
      "react-hook-form is prohibited; use the application TanStack Form composition",
      errors,
    );
    if (fileName.endsWith(".tsx")) {
      for (const index of rawFormFailures(content)) {
        errors.push(
          format(
            root,
            file,
            content,
            index,
            "production forms must use the application TanStack Form composition",
          ),
        );
      }
    }

    if (fileName !== API_TRANSPORT_FILE) {
      patternFailures(
        root,
        file,
        content,
        /\bfetch\s*\(/gu,
        "direct fetch bypasses endpoint contracts",
        errors,
      );
    }
    for (const match of content.matchAll(
      /\bapiClient\.request\(\s*([A-Za-z_$][\w$]*Endpoints)\.([A-Za-z_$][\w$]*)/gu,
    )) {
      const operations = usedEndpointOperations.get(match[1]) ?? new Set();
      operations.add(match[2]);
      usedEndpointOperations.set(match[1], operations);
    }
  }

  const endpointIndex = resolve(
    root,
    "packages/contracts/src/api/endpoints.ts",
  );
  let endpointSource = "";
  try {
    endpointSource = await readFile(endpointIndex, "utf8");
  } catch {
    if (usedEndpointOperations.size)
      errors.push(
        `${relative(root, endpointIndex)}:1: endpoint index is required for frontend-used contracts`,
      );
  }
  const contractFiles = await walk(resolve(root, CONTRACTS_API_DIRECTORY));
  for (const [group, operations] of [...usedEndpointOperations.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (
      !new RegExp(`\\b[A-Za-z_$][\\w$]*\\s*:\\s*${group}\\b`, "u").test(
        endpointSource,
      )
    ) {
      errors.push(
        `${relative(root, endpointIndex)}:1: frontend uses ${group} without registering its endpoint contracts`,
      );
      continue;
    }
    const groupSource = (
      await Promise.all(
        contractFiles.map(async (file) => ({
          file,
          content: await readFile(file, "utf8"),
        })),
      )
    ).find(({ content }) =>
      new RegExp(`export\\s+const\\s+${group}\\s*=`, "u").test(content),
    );
    for (const operation of operations) {
      if (
        !groupSource ||
        !new RegExp(`\\b${operation}\\s*:`, "u").test(groupSource.content)
      ) {
        errors.push(
          `${relative(root, endpointIndex)}:1: frontend uses ${group}.${operation} but that operation is absent from the exported endpoint registry`,
        );
      }
    }
  }

  for (const file of (await walk(sourceRoot))
    .filter((path) => path.endsWith(".css"))
    .sort()) {
    const content = await readFile(file, "utf8");
    const physical =
      /(?:^|[;{\s])(?:left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:|\bfloat\s*:\s*(?:left|right)\b|\btext-align\s*:\s*(?:left|right)\b/gmu;
    patternFailures(
      root,
      file,
      content,
      physical,
      "physical CSS must use logical properties",
      errors,
    );
  }
  return errors;
}

async function main() {
  const errors = await checkFrontendContracts();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("frontend contract enforcement passed");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
