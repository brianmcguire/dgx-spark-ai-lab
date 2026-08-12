# Configuration

Configuration is loaded in this order:

1. `config/default.json`
2. `config/dashboard.local.json`, or the file named by `DASHBOARD_CONFIG`
3. supported environment-variable overrides

Objects are merged recursively. Local configuration files are ignored by Git.

## Dashboard Modes

- `readonly`: health and telemetry only
- `benchmark`: health, telemetry, and benchmark requests
- `full`: all configured capabilities, including model control and Spark Doctor

## Compute Connections

- `local`: collectors execute on the dashboard host
- `ssh`: collectors execute using the configured SSH host or alias

Passwordless SSH is recommended for unattended operation. Test it with `ssh -o BatchMode=yes <host> true`.

## Model Catalog

Copy `config/models.example.json` to `config/models.local.json` and define models already downloaded on the compute host. By default, custom entries merge with built-ins by `key`. Set `"mode": "replace"` to use only custom entries.

Catalog entries influence vLLM launch commands. Treat catalog write access as privileged.

## Write Authentication

Benchmark, Spark Doctor, and model-control requests are write operations. A write-enabled profile bound beyond loopback must set `security.controlToken` or `DASHBOARD_CONTROL_TOKEN`. The remote setup wizard generates this token automatically.

`security.allowUnauthenticatedControl: true` is an explicit escape hatch for a host already isolated by a trusted private-network policy. It is disabled by default and must never be used on a publicly reachable host.

## Environment Overrides

See `.env.example`. Secrets should be provided through the process environment, never committed JSON.
