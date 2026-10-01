#!/usr/bin/env bash

set -e

SCRIPT_DIR=$(realpath "$(dirname "$0")")
ROOT_DIR="$SCRIPT_DIR/.."
ENV_FILE="$ROOT_DIR/.env.local"

if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"
fi

npm run local-ts
