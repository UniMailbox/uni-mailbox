const actionReferencePattern = /^\s*-?\s*uses:\s*["']?([^\s"']+)["']?/gmu;
const fullCommitPattern = /^[^@\s]+@[0-9a-f]{40}$/u;

export function findUnpinnedActions(source) {
  return [...source.matchAll(actionReferencePattern)]
    .map((match) => match[1])
    .filter((reference) => !reference.startsWith("./"))
    .filter((reference) => !fullCommitPattern.test(reference));
}
