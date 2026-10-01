#!/usr/bin/env bash
# Source this from the host shell immediately before invoking cmd-run-tests.
# Never write decrypted test credentials to config, argv, logs, or files.
set +x

# Only direct, quoted scalars in the e2e YAML are supported. An unsupported
# config must fail rather than fetching credentials for a different customer.
e2e_config_value() {
    local value
    value="$(awk -v wanted="$2" '
        /^[^[:space:]#][^:]*:/ { scope = $1; sub(/:$/, "", scope) }
        wanted == "region" && scope != "credentials" { next }
        wanted != "region" && /^[[:space:]]/ { next }
        $1 == wanted ":" {
            scalar = $0
            sub(/^[[:space:]]*[A-Za-z0-9_-]+:[[:space:]]*/, "", scalar)
            sub(/[[:space:]]*$/, "", scalar)
            if (scalar ~ /^"[A-Za-z0-9_-]+"$/ || scalar ~ /^\047[A-Za-z0-9_-]+\047$/) {
                print substr(scalar, 2, length(scalar) - 2)
                exit
            }
        }
    ' "$1" 2>/dev/null)" || return 1
    [ -n "$value" ] || return 1
    printf '%s' "$value"
}

e2e_secret_failure() {
    printf '%s\n' 'e2e test credential fetch failed (details suppressed)' >&2
    return 1
}

fetch_e2e_ssm_secret() {
    local target="$1" parameter="$2" region="$3" retrieved
    # The final sentinel survives command substitution, preserving *all* PEM
    # trailing newlines. jq checks both SecureString type and nonempty value.
    if ! retrieved="$(aws ssm get-parameter --region "$region" --name "$parameter" --with-decryption --output json --no-cli-pager 2>/dev/null |
        jq -erj '.Parameter | select(.Type == "SecureString") | .Value | select(type == "string" and length > 0)' 2>/dev/null && printf '.')"; then
        e2e_secret_failure
        return 1
    fi
    printf -v "$target" '%s' "${retrieved%.}"
    export "$target"
}

fetch_e2e_test_credentials() {
    set +x
    set -o pipefail
    local customer="$1" org="$2" region="$3"
    if [[ ! "$customer" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ||
          ! "$org" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ||
          ! "$region" =~ ^[a-z0-9]+(-[a-z0-9]+)+-[0-9]+$ ||
          -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
        e2e_secret_failure
        return 1
    fi

    # Match the pinned firestartr-core SecureString paths. The org segment is
    # only used upstream for installation-ID, not for these three test secrets.
    fetch_e2e_ssm_secret GITHUB_APP_ID "/firestartr/${customer}/fs-${customer}-admin/app-id" "$region" || return 1
    fetch_e2e_ssm_secret GITHUB_APP_PEM_FILE "/firestartr/${customer}/fs-${customer}-admin/pem" "$region" || return 1
    fetch_e2e_ssm_secret PREFAPP_BOT_PAT "/firestartr/${customer}/prefapp-bot-pat" "$region" || return 1
}
