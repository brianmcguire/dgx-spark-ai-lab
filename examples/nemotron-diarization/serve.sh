#!/usr/bin/env bash
set -euo pipefail
: "${SPARK_BIND_IP:?Set SPARK_BIND_IP to the private Spark interface address}"
: "${MODEL_API_KEY_FILE:?Set MODEL_API_KEY_FILE to a readable bearer-token file}"
model_cache="${HF_CACHE_DIR:-$HOME/.cache/huggingface}"
stop() { docker stop -t 30 spark-nemotron-diarization >/dev/null 2>&1 || true; }
trap stop TERM INT EXIT
docker run --rm --name spark-nemotron-diarization --gpus all --shm-size=1g --memory=8g \
  -p "${SPARK_BIND_IP}:8021:8021" \
  -e HF_HOME=/hf -e HF_HUB_OFFLINE=1 -e TOKENIZERS_PARALLELISM=false \
  -v "${model_cache}:/hf:ro" \
  -v "${MODEL_API_KEY_FILE}:/run/model-key:ro" \
  -v "$(dirname "$(realpath "$0")")/service.py:/app/service.py:ro" \
  --entrypoint python spark-lab/nemotron-3-diarization:20260923 /app/service.py nvidia/Nemotron-3-Diarization &
child=$!
wait "$child"
