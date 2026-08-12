#!/bin/bash
set -euo pipefail

SERVICE_ROOT="/Users/nexus/services/litellm-gateway"
exec "$SERVICE_ROOT/.venv/bin/litellm" \
  --config "$SERVICE_ROOT/config.yaml" \
  --host 127.0.0.1 \
  --port 4010
