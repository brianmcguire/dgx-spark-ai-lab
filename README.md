# DGX Spark AI Lab

A self-hosted dashboard for local AI inference health, vLLM telemetry, controlled model switching, and repeatable coding and visual benchmarks.

The project supports a single local computer or a split dashboard/compute deployment. The full model controller is designed for a DGX Spark running vLLM under PM2, while monitoring and benchmarking can run against any reachable OpenAI-compatible endpoint.

> This is an independent community project. It is not affiliated with or endorsed by NVIDIA. NVIDIA, DGX, and DGX Spark are trademarks of NVIDIA Corporation.

## Features

- CPU, memory, disk, network, NVIDIA GPU, power, and temperature telemetry
- vLLM throughput, queue, cache, latency percentile, endpoint, and speculative-decoding diagnostics
- Coding and visual benchmark suites with persistent, comparable history
- Optional model controller with readiness checks, smoke tests, and automatic rollback
- Local or SSH collectors
- Optional PM2 service and LiteLLM gateway health
- Capability-driven responsive UI for desktop and mobile
- Safe read-only localhost profile by default

## Deployment Options

| Topology | Health | Benchmarks | Model control |
| --- | --- | --- | --- |
| One Mac, Linux PC, or DGX system | Yes | Optional | DGX/vLLM profile only |
| Dashboard host plus remote compute over SSH | Yes | Yes | DGX/vLLM profile only |
| Any OpenAI-compatible inference endpoint | Basic | Yes | No |

Rich GPU and vLLM panels appear only when their telemetry is available. A Mac-only installation does not require a DGX Spark.

## Quick Start

Requirements: Node.js 22 or newer and npm.

```bash
git clone https://github.com/brianmcguire/dgx-spark-ai-lab.git
cd dgx-spark-ai-lab
npm ci
npm run setup
npm run doctor
npm run build
npm start
```

Open `http://127.0.0.1:4174`. The default profile is read-only and local-only.

## Profiles

`npm run setup` creates the ignored `config/dashboard.local.json` file. Available starting points are:

- **Local monitoring:** health and available telemetry, no write operations
- **Local benchmarking:** sends benchmark requests to a local OpenAI-compatible endpoint
- **Remote DGX Spark:** SSH telemetry and optional vLLM/PM2 model control

Advanced users can copy and edit:

- `config/default.json`
- `config/local-benchmark.example.json`
- `config/remote-dgx.example.json`
- `config/models.example.json`

See [configuration](docs/CONFIGURATION.md) for precedence, capabilities, and environment overrides.

## Security

Model replacement and benchmark routes can consume substantial resources or interrupt applications. For full mode:

```bash
export DASHBOARD_CONTROL_TOKEN='use-a-long-random-value'
npm start
```

Use the **Unlock** command in the dashboard to enter that token. Keep the dashboard on localhost or a private network such as Tailscale. Do not publish it directly to the internet.

The setup wizard generates a private control token for remote full-mode profiles. An advanced deployment already protected by a private-network policy may explicitly set `security.allowUnauthenticatedControl` to `true`, but this removes application-level authentication and should not be used on a publicly reachable host.

Review [SECURITY.md](SECURITY.md) before enabling model control.

## Production Service

Build and start with PM2:

```bash
npm run build
npm run pm2:start
pm2 save
```

See [deployment](docs/DEPLOYMENT.md) for reboot persistence and private-network guidance. An optional stable LiteLLM application alias is demonstrated in `examples/litellm/`.

## Development

```bash
npm run dev
npm test
npm run build
```

Architecture details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Contributions are covered by [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
