function sortedBindings(entries = []) {
  return entries
    .map((entry) => entry.binding)
    .filter(Boolean)
    .sort();
}

function displayBindings(entries) {
  return entries.length > 0 ? entries.join(",") : "(none)";
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

function differs(left, right) {
  return JSON.stringify(stable(left)) !== JSON.stringify(stable(right));
}

function findConfigErrors(base, overlay, prefix = "") {
  const errors = [];
  for (const field of [
    "main",
    "compatibility_date",
    "compatibility_flags",
    "assets",
    "version_metadata",
    "triggers",
  ]) {
    if (differs(base?.[field], overlay?.[field])) {
      errors.push(`${prefix}${field} differs`);
    }
  }
  for (const field of ["d1_databases", "kv_namespaces"]) {
    const baseBindings = sortedBindings(base?.[field]);
    const overlayBindings = sortedBindings(overlay?.[field]);
    if (differs(baseBindings, overlayBindings)) {
      errors.push(
        `${prefix}${field} bindings differ: ${displayBindings(baseBindings)} != ${displayBindings(overlayBindings)}`,
      );
    }
  }
  const baseProducerBindings = sortedBindings(base?.queues?.producers);
  const overlayProducerBindings = sortedBindings(overlay?.queues?.producers);
  if (differs(baseProducerBindings, overlayProducerBindings)) {
    errors.push(
      `${prefix}queue producer bindings differ: ${displayBindings(baseProducerBindings)} != ${displayBindings(overlayProducerBindings)}`,
    );
  }
  return errors;
}

export function findWranglerParityErrors(base, overlay) {
  const errors = [
    ...findConfigErrors(base, overlay),
    ...findConfigErrors(
      base?.env?.preview,
      overlay?.env?.preview,
      "env.preview.",
    ),
  ];
  for (const [label, config] of [
    ["base", base],
    ["overlay", overlay],
    ["base env.preview", base?.env?.preview],
    ["overlay env.preview", overlay?.env?.preview],
  ]) {
    if (config?.version_metadata?.binding !== "CF_VERSION_METADATA") {
      errors.push(`${label} must bind version metadata as CF_VERSION_METADATA`);
    }
  }
  return errors;
}
