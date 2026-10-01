#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/load-e2e-auth.sh"

MOCK_APP_ID='synthetic-app-id-canary'
MOCK_PEM=$'-----BEGIN SYNTHETIC KEY-----\nsynthetic-pem-canary\n-----END SYNTHETIC KEY-----\n\n'
MOCK_PAT='synthetic-bot-pat-canary'
MOCK_CUSTOMER='synthetic-customer'
MOCK_REGION='eu-west-1'
MOCK_FAILURE=''
MOCK_TYPE='SecureString'
AWS_ACCESS_KEY_ID='synthetic-aws-key-canary'
AWS_SECRET_ACCESS_KEY='synthetic-aws-secret-canary'
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

aws() {
    [[ $# -eq 10 && "$1" == ssm && "$2" == get-parameter && "$3" == --region &&
        "$4" == "$MOCK_REGION" && "$5" == --name && "$7" == --with-decryption &&
        "$8" == --output && "$9" == json && "${10}" == --no-cli-pager ]] || return 1
    [[ "$6" != "$MOCK_FAILURE" ]] || { printf 'synthetic AWS denial with untrusted details\n' >&2; return 1; }
    local value
    case "$6" in
        "/firestartr/${MOCK_CUSTOMER}/fs-${MOCK_CUSTOMER}-admin/app-id") value="$MOCK_APP_ID" ;;
        "/firestartr/${MOCK_CUSTOMER}/fs-${MOCK_CUSTOMER}-admin/pem") value="$MOCK_PEM" ;;
        "/firestartr/${MOCK_CUSTOMER}/prefapp-bot-pat") value="$MOCK_PAT" ;;
        *) return 1 ;;
    esac
    jq -nc --arg value "$value" --arg type "$MOCK_TYPE" '{Parameter: {Type: $type, Value: $value}}'
}

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
assert_safe_failure() {
    local message
    if message="$(fetch_e2e_test_credentials "$MOCK_CUSTOMER" synthetic-org "$MOCK_REGION" 2>&1)"; then
        fail 'unexpected successful fetch'
    fi
    [[ "$message" == 'e2e test credential fetch failed (details suppressed)' ]] || fail 'failure output was not constant and safe'
}

fetch_e2e_test_credentials "$MOCK_CUSTOMER" synthetic-org "$MOCK_REGION" || fail 'synthetic lookup failed'
[[ "$GITHUB_APP_ID" == "$MOCK_APP_ID" && "$GITHUB_APP_PEM_FILE" == "$MOCK_PEM" && "$PREFAPP_BOT_PAT" == "$MOCK_PAT" ]] || fail 'test credential mismatch or PEM newline loss'
[[ "$(e2e_config_value ../../.github/e2e.yaml customer)" == firestartr-e2e ]] || fail 'config customer parsing failed'
[[ "$(e2e_config_value ../../.github/e2e.yaml region)" == eu-west-1 ]] || fail 'config region parsing failed'
[[ "$(e2e_config_value <(printf 'region: "wrong"\ncredentials:\n  region: "eu-west-1"\n') region)" == eu-west-1 ]] || fail 'config region escaped its credentials scope'
trace_output="$({ set -x; fetch_e2e_test_credentials "$MOCK_CUSTOMER" synthetic-org "$MOCK_REGION"; } 2>&1)" || fail 'fetch under xtrace failed'
[[ "$trace_output" != *"$MOCK_APP_ID"* && "$trace_output" != *"$MOCK_PEM"* && "$trace_output" != *"$MOCK_PAT"* ]] || fail 'secret appeared in shell trace'

MOCK_FAILURE="/firestartr/${MOCK_CUSTOMER}/fs-${MOCK_CUSTOMER}-admin/pem"
assert_safe_failure
MOCK_FAILURE=''
MOCK_TYPE='String'
assert_safe_failure
MOCK_TYPE='SecureString'
MOCK_APP_ID=''
assert_safe_failure
MOCK_APP_ID='synthetic-app-id-canary'
if fetch_e2e_test_credentials '../wrong-customer' synthetic-org "$MOCK_REGION" >/dev/null 2>&1; then
    fail 'invalid customer was accepted'
fi
printf 'Synthetic e2e SSM credential checks passed.\n'
