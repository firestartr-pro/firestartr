#!/usr/bin/env bash
set -euo pipefail

SUITE="${SUITE:-}"
SUITE_PREFIX=""
if [ -n "$SUITE" ]; then
  SUITE_PREFIX=" — ${SUITE}"
fi

LOG_FILE="${E2E_LOG_FILE:-$RUNNER_TEMP/e2e-tests${SUITE:+-${SUITE}}.log}"
TEST_STEP_OUTCOME="${TEST_STEP_OUTCOME:-unknown}"

{
  echo "## E2E Tests Summary${SUITE_PREFIX}"
  echo ""
  echo "- Test step outcome: \`${TEST_STEP_OUTCOME}\`"
  echo "- Suite: \`${SUITE:-all}\`"
  if [ "${TEST_STEP_OUTCOME}" = "success" ]; then
    echo "- Result: ✅ E2E tests passed"
  else
    echo "- Result: ❌ E2E tests failed"
  fi
  echo ""
} >> "$GITHUB_STEP_SUMMARY"

if [ ! -f "$LOG_FILE" ]; then
  echo "No e2e log file was generated." >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

# Strip ANSI escape codes from the log.
CLEAN_LOG="$RUNNER_TEMP/e2e-clean${SUITE:+-${SUITE}}.log"
sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$LOG_FILE" > "$CLEAN_LOG"

# On failure, dagger dumps a clean "Stderr:" section at the end
# containing the full jest output without TUI prefixes.
# Extract the last jest block (FAIL/PASS → Ran all test suites) from there.
STDERR_LINE=$(grep -n "^Stderr:$" "$CLEAN_LOG" | tail -1 | cut -d: -f1 || true)

# Dagger prints live logs and then repeats command stderr at the end.
# Prefer the final clean stderr block for summaries to avoid duplicates.
SUMMARY_LOG="$RUNNER_TEMP/e2e-summary-source${SUITE:+-${SUITE}}.log"
if [ -n "$STDERR_LINE" ]; then
  tail -n +$((STDERR_LINE + 1)) "$CLEAN_LOG" > "$SUMMARY_LOG"
else
  sed 's/^.*| //' "$CLEAN_LOG" > "$SUMMARY_LOG"
fi

JEST_OUTPUT=$(awk '
  /^(PASS|FAIL) /{capture=1; skip_console=0; print; next}
  !capture{next}
  /^Ran all test suites/{print; capture=0; skip_console=0; print ""; next}
  /^(Test Suites:|Tests:|Snapshots:|Time:)/{skip_console=0; print; next}
  /^[[:space:]]+console\.(debug|error|info|log|warn)$/{skip_console=1; next}
  skip_console && (/^[[:space:]]/ || /^$/){next}
  skip_console{skip_console=0}
  /^[[:space:]]/{print; next}
  /^$/{print; next}
' "$SUMMARY_LOG")

if [ -n "$JEST_OUTPUT" ]; then
  {
    echo "### Jest output"
    echo '```'
    echo "$JEST_OUTPUT"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
elif [ "${TEST_STEP_OUTCOME}" != "success" ]; then
  {
    echo "### Jest final output"
    echo "No Jest output block found. Showing final error lines only."
    echo '```'
    grep -E '(^FAIL |^FATAL ERRORS:|^Error:|ERROR|Error:|DLH|failed|Failure)' "$SUMMARY_LOG" | tail -80 || true
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi

# ── Lifecycle timeline ────────────────────────────────────────────────
LIFECYCLE_FILE="$RUNNER_TEMP/e2e-lifecycle${SUITE:+-${SUITE}}.txt"
sed 's/^.*| //' "$CLEAN_LOG" \
  | grep '\[E2E_LIFECYCLE\].*failed' \
  | sed 's/^.*\[E2E_LIFECYCLE\]/[E2E_LIFECYCLE]/' \
  | awk '!seen[$0]++' \
  | tail -40 > "$LIFECYCLE_FILE" || true

if [ -s "$LIFECYCLE_FILE" ]; then
  {
    echo ""
    echo "### Failed resource lifecycle"
    echo ""
    echo "| Status | Phase | Resource |"
    echo "|---|---|---|"
    awk '
      {
        line=$0
        sub(/^\[E2E_LIFECYCLE\] /, "", line)
        phase=line
        sub(/ .*/, "", phase)
        resource=line
        sub(/^[^ ]+ +/, "", resource)
        icon="❌"
        gsub(/\|/, "\\\\|", resource)
        printf "| %s | `%s` | `%s` |\n", icon, phase, resource
      }
    ' "$LIFECYCLE_FILE"
  } >> "$GITHUB_STEP_SUMMARY"
fi

# ── Diagnostic blocks ─────────────────────────────────────────────────
# Extract every E2E_DIAGNOSTIC_BEGIN … E2E_DIAGNOSTIC_END block and
# deduplicate live Dagger output vs repeated stderr output.
DIAG_FILE="$RUNNER_TEMP/e2e-diagnostics${SUITE:+-${SUITE}}.txt"
sed 's/^.*| //' "$CLEAN_LOG" \
  | awk '
    /\[E2E_DIAGNOSTIC_BEGIN\]/{in_block=1; block=""}
    in_block{block=block $0 "\n"}
    /\[E2E_DIAGNOSTIC_END\]/{
      if (!seen[block]++) printf "%s\n", block
      in_block=0
    }
  ' > "$DIAG_FILE"

if [ -s "$DIAG_FILE" ]; then
  {
    echo ""
    echo "### Failure diagnostics"
    echo '```'
    cat "$DIAG_FILE"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi
