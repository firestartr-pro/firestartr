---
name: dependabot-smoke-test
description: Evaluate one or more Dependabot dependency-bump PRs and give a MERGE / DO NOT MERGE recommendation per PR, based on CI status and local test results.
disable-model-invocation: true
---

# dependabot-smoke-test

Input: PR numbers, URLs, lists or inclusive ranges (`2247-2249`). Process them
one at a time. Every PR, and every early exit, starts and ends with a clean
slate: `make clean && make clean-modules`. A dirty tree is the main source of
false results.

## Per PR

1. **Resolve.** `gh pr view <PR> --json number,title,headRefName,files,body,state`.
   It must be open with a `dependabot/` branch; otherwise record
   **BLOCKED — not a Dependabot PR**. Note the package and the old → new
   versions.
2. **CI.** Find the latest `pr_verify.yaml` run on the branch (`gh run list`,
   `gh run view --json jobs`).
   - Green: continue.
   - Red: show the failed jobs (`--log-failed`) and ask whether to fix, stop
     (**DO NOT MERGE — CI failed, user declined**) or skip (**BLOCKED**).
   - Pending: ask whether to wait. No run: note it and continue.
3. **Affected packages.**
   `node .agents/skills/dependabot-smoke-test/affected-packages.cjs <PR>`
   (direct plus transitive; a root-only bump affects everything).
4. **Check out.** Clean slate, `git switch -C <branch> origin/<branch>`,
   `npm install` (on failure: **BLOCKED — install failure**).
5. **Test.** In each affected package run its lint and tests (see its
   `RULES.md`), plus the `AGENTS.md` post-change check for `operator` and
   `cdk8s_renderer`. Record outcome, test count and exact failure text.
6. **Restore.** `git checkout -`, then clean slate.
7. **Report.** Post the comment from [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md)
   on every PR, BLOCKED included.

## Fixing red CI

Only after the user says yes. `lint-and-transpile` covers root lint, the
`cli` transpile and cdk8s import drift; `unit-tests (<name>)` covers
`packages/<name>`. Apply the smallest fix inside the failing scope, and record
the cause and the change. For import drift, regenerate the imports as described
in `packages/k8s/RULES.md`. Commit on the PR branch only with permission.

## Never

- Run `packages/e2e` unless asked and the cluster is confirmed up.
- Merge a PR, or judge security or API compatibility; that's for a human.
