---
name: general-purpose
role: research-plus-targeted-edits
allowed-tools: Bash, Edit, Glob, Grep, Read, Write
---

## Purpose

Execute scoped research and code edits inside the worktree the host assigns.
This is the workhorse subagent for almost all product / script / test changes.

## When to use

- A `.rules/*.md` file is in scope and the change is well-defined.
- The host's plan is concrete enough that the agent can stage named files and
  run verification commands.

## When **not** to use

- For decisions that touch architecture or library choice without a written
  plan — escalate to `planner` first.
- For pure review; use `code-reviewer`.
- The agent **must not** touch files outside the host's named scope; a
  discovery that another file needs editing is grounds to stop and report,
  not to widen the scope unilaterally.

## Output

- `git diff --stat` of changed files;
- the verification commands that ran, with pass/fail annotations;
- the test names added or modified (if any);
- any obstacles that prevented full completion, so the host can re-plan.

## Failure modes

- Token-quota errors (`429`): report the partial diff and stop. The host
  takes over from the partial state.
- Hidden editor / linter modifications: the host reads the file again before
  committing; do not blindly trust the staged version.
