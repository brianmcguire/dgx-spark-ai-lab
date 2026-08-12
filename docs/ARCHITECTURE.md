# Architecture

The project is one Node.js service with a Vite/React client.

## Runtime Layers

- **Collectors:** local shell commands or SSH collect system, NVIDIA, Docker, and optional PM2 telemetry.
- **Inference adapter:** reads the OpenAI-compatible `/v1/models` endpoint and Prometheus metrics exposed by vLLM.
- **Control adapter:** an optional DGX/vLLM PM2 controller performs model replacement, readiness checks, smoke tests, and rollback.
- **History store:** local JSON data under `.data/` retains health samples and benchmark results.
- **Web client:** capability-driven navigation hides features that are unavailable in the selected profile.

## Supported Topologies

1. One local computer in read-only monitoring mode.
2. One local computer running an OpenAI-compatible server and benchmarks.
3. A dashboard host monitoring a remote Linux/NVIDIA compute host over SSH.
4. A full DGX Spark deployment with vLLM model control, optional Spark Doctor, PM2 services, and a stable application gateway.

The full model controller is currently vLLM- and PM2-specific. Monitoring and benchmarking are provider-neutral as long as the inference service exposes OpenAI-compatible APIs; rich telemetry requires vLLM Prometheus metrics.
