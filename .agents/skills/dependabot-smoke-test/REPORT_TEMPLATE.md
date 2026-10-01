# Report template

## Per-PR comment

```
## Dependabot Smoke-Test Report

**PR:** #<number> — <title>
**Branch:** <headRefName>
**Bumped package:** <name> <old> → <new> (runtime | dev-only)

### CI (pr-verify)

| Job | Result |
|---|---|
| lint-and-transpile | SUCCESS / FAILURE |
| unit-tests (<name>) | SUCCESS / FAILURE |

CI was green / CI had failures — <what was fixed, or "no fixes applied">.

### Affected packages

| Package | Direct | Transitive |
|---|---|---|
| <name> | yes/no | yes/no |

### Smoke-test results

| Package | Lint | Tests | Notes |
|---|---|---|---|
| <name> | PASS/FAIL | PASS/FAIL (N) | <failure summary> |

### Recommendation

MERGE — CI green, all affected packages pass.
MERGE (after fix) — CI failures corrected (<what>); local tests pass.
DO NOT MERGE — <package> fails: <first failure summary>.
DO NOT MERGE — CI failed, user declined to investigate.
BLOCKED — <reason>.
```

Post with `--body-file` so log content needs no quoting:

```sh
cat <<'EOF' | gh pr comment <number> --body-file -
<report body here>
EOF
```

Mention packages that were skipped (no test script) or need a cluster.

## Summary (multi-PR runs, local only)

```
## Summary

| PR | Package bumped | CI | Recommendation |
|---|---|---|---|
| #2247 | tar 7.5.15 → 7.5.19 | green | MERGE |
| #2248 | cdk8s-cli 2.207.5 → 2.207.32 | red (fixed) | MERGE (after fix) |
```
