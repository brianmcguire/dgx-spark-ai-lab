# NVIDIA DGX Spark AI Lab

Private operations dashboard for a DGX Spark and its supporting Mac Mini services. It combines system health, vLLM telemetry, primary-model control, and repeatable model benchmarks.

## Features

- DGX Spark health, memory, GPU, power, temperature, disk, and network telemetry
- vLLM token throughput, latency, queue, cache, and speculative-decoding diagnostics
- Controlled primary-model replacement with readiness checks and rollback
- Coding and visual model benchmark workflows with retained history
- Mac Mini PM2 service status and agent-gateway validation
- Responsive desktop and mobile interface

## Requirements

- Node.js 22 or newer
- Passwordless SSH access to the DGX Spark host configured by `DGX_HOST`
- A vLLM OpenAI-compatible endpoint
- Optional LiteLLM gateway for stable application routing

## Local Setup

```bash
npm install
cp .env.example .env
npm run build
HOST=0.0.0.0 PORT=4174 npm start
```

The dashboard is then available at `http://localhost:4174`. When bound to `0.0.0.0`, it can also be reached through the Mac Mini's Tailscale address.

## Configuration

The server supports these environment variables:

| Variable | Purpose |
| --- | --- |
| `HOST` | Dashboard bind address |
| `PORT` | Dashboard port |
| `DGX_HOST` | SSH host or alias for the DGX Spark |
| `MAC_MINI_HOST` | SSH target used for Mac Mini collectors |
| `VLLM_METRICS_URL` | vLLM Prometheus metrics endpoint |
| `VLLM_API_URL` | vLLM OpenAI-compatible API base URL |
| `VLLM_API_KEY` | Optional vLLM API key |
| `AGENT_GATEWAY_API_URL` | Stable LiteLLM or application gateway API URL |
| `HISTORY_LIMIT` | Maximum retained health samples |
| `HISTORY_RETENTION_DAYS` | Health-history retention period |
| `HF_CACHE_TTL_MS` | Hugging Face metadata cache duration |
| `VLLM_LIVE_POLL_INTERVAL_MS` | Live vLLM polling interval |
| `SYNTHETIC_PROBE_INTERVAL_MS` | Synthetic endpoint-probe interval |
| `LATENCY_HISTORY_LIMIT` | Maximum retained latency samples |

The included LiteLLM configuration and launch-service files are deployment templates. Adjust hostnames and filesystem paths for the target Mac before installing them.

## Security

This dashboard can stop and replace the active vLLM model. Keep it private and restrict access through Tailscale or another trusted network. Do not expose it directly to the public internet.

Runtime databases, benchmark history, generated builds, dependencies, logs, and local environment files are excluded from Git.
