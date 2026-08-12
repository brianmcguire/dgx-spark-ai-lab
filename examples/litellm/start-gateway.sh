#!/usr/bin/env bash
set -euo pipefail

SERVICE_ROOT="${SERVICE_ROOT:-$HOME/services/litellm-gateway}"
exec "$SERVICE_ROOT/.venv/bin/litellm" \
  --config "$SERVICE_ROOT/config.yaml" \
  --host "${GATEWAY_HOST:-127.0.0.1}" \
  --port "${GATEWAY_PORT:-4010}"
