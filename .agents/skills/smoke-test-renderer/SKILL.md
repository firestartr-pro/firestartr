---
name: smoke-test-renderer
description: Run live smoke tests of Component, User, Group and OrgWebhook claims on a pre-environment org with smoke-tests/scripts/smoke.sh (clone claims, hydrate, merge or revert, clean up).
disable-model-invocation: true
---

# smoke-test-renderer

Drive `bash smoke-tests/scripts/smoke.sh --org <org> <command>`; `--help` lists
the commands. Don't reimplement it.

## Rules

- Ask the user for the org; never assume it. It must be registered in
  `firestartr-pre/app-firestartr` under `kubernetes/firestartr-pre/<org>/`.
- Every live command (`setup`, `hydrate`, `merge`, `close`, `revert`) needs
  explicit user approval. `merge`, `close` and `revert` always prompt, even
  with `--yes`.
- Only touch claims annotated `firestartr.dev/ia-test: "true"`. `create` only
  accepts sources inside the clone (`.tmp_dir/orgs/<org>/claims`), so copy a
  base fixture from `packages/cdk8s_renderer/__tests__/fixtures/base_claims/`
  into it first.
- Never `git commit` in this repository; the script commits only in the clone.
- `setup` creates one `test/ia-*` branch; re-run it to reuse the branch, and
  run `cleanup` before creating another.

## Lifecycle

1. `setup`, then `versions`, and have the user confirm the operator image and
   CLI version.
2. For each test: `create` or `patch`, `hydrate`, `summary`, `merge` if the
   user approves, then `check`.
3. Finish: `revert` merged PRs (dependents first) or `close` unmerged ones,
   then `cleanup`. Confirm with `status` that no PRs, branches, resources or
   `.tmp_dir/orgs/<org>` remain before calling it done.
