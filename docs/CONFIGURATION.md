# Configuration

Configuration is loaded in this order:

1. `config/default.json`
2. `config/dashboard.local.json`, or the file named by `DASHBOARD_CONFIG`
3. supported environment-variable overrides

Objects are merged recursively. Local configuration files are ignored by Git.

## Guided Settings

The dashboard includes a **Settings** tab for the options most operators need after installation. It reads the effective configuration, identifies values controlled by environment variables, validates changes, and writes only approved fields to the ignored local configuration file.

The guided editor covers:

- Dashboard identity, logo, mode, host, and port
- Compute label and local or SSH connection
- Inference API and metrics URLs
- Optional PM2 and gateway integrations

After saving, restart the dashboard service so server-side collectors and listeners use the new values. Environment-managed fields are read-only in the UI because environment variables have higher precedence.

The browser editor deliberately excludes:

- Control tokens, credentials, and SSH keys
- Model catalog entries and vLLM launch arguments
- Arbitrary commands and process definitions
- Trusted-network security exceptions

Manage those values through environment variables or reviewed local files. The write endpoint applies the same control-token and private-host safety rules as model control.

## Schema Validation

`config/dashboard.schema.json` documents the portable configuration format and enables validation and completion in schema-aware editors. To associate a local file manually, add this editor-only property while editing and remove it if your tooling does not support it:

```json
{
  "$schema": "./dashboard.schema.json"
}
```

The schema allows extension fields so optional collectors and future engine adapters can evolve without invalidating existing installations.

## Dashboard Modes

- `readonly`: health and telemetry only
- `benchmark`: health, telemetry, and benchmark requests
- `full`: all configured capabilities, including model control and Spark Doctor

## Dashboard Branding

Every installation includes `public/dgx-spark-icon.png`, which is used by default in the upper-left profile area and as the installed web-app icon. Vite copies this asset into every production build.

Override the sidebar image in `config/dashboard.local.json`:

```json
{
  "dashboard": {
    "logoUrl": "/my-lab-logo.png",
    "logoAlt": "My AI lab profile"
  }
}
```

For a local image, place the file in `public/` before building and use its root-relative path, such as `/my-lab-logo.png`. An HTTPS image URL is also supported. If a custom image cannot load, the dashboard automatically falls back to `/dgx-spark-icon.png`. `DASHBOARD_LOGO_URL` can override the configured URL at runtime.

## Compute Connections

- `local`: collectors execute on the dashboard host
- `ssh`: collectors execute using the configured SSH host or alias

Passwordless SSH is recommended for unattended operation. Test it with `ssh -o BatchMode=yes <host> true`.

## Model Catalog

Copy `config/models.example.json` to `config/models.local.json` and define models already downloaded on the compute host. By default, custom entries merge with built-ins by `key`. Set `"mode": "replace"` to use only custom entries.

The optional discovery block scans the configured Hugging Face cache for downloaded checkpoints:

```json
{
  "mode": "merge",
  "discovery": {
    "enabled": true,
    "includeUnknown": true
  },
  "initialPrimary": null,
  "models": []
}
```

Discovery is inventory only. A checkpoint without a matching model entry appears as **Discovered** with a disabled **Setup Required** action. This is intentional: vLLM launch arguments, parsers, context limits, quantization settings, and runtime images vary by model. Review the model card and add a model recipe before enabling it.

At startup, the dashboard adopts the model already reported by the configured `/v1/models` endpoint. It does not automatically start or replace a model. `initialPrimary` is reserved for deployment tooling and does not override a running service.

Use `enabledKeys` when an installation should expose only a subset of a shared catalog:

```json
{
  "enabledKeys": ["my-model-nvfp4"]
}
```

Catalog entries influence vLLM launch commands. Treat catalog write access as privileged.

### Retired models and benchmark history

Benchmark files are independent of model checkpoints. New runs save a presentation snapshot, so their model name and provider icon remain available after the checkpoint and controller recipe are removed. For older runs, add a presentation-only entry to `historyModels` in `config/models.local.json`. These entries never appear in Model Controller and the server strips controller fields from them.

Keep provider icons under `public/provider-logos/` even after deleting a checkpoint. See [Benchmark and icon retention](BENCHMARK_RETENTION.md) for the removal checklist and configuration example.

## Optional Spark Doctor Integration

[Spark Doctor](https://github.com/joeynyc/spark-doctor) is an independent, MIT-licensed DGX Spark diagnostic CLI. It is not bundled or installed by Spark AI Lab. Install it separately on the compute host, then enable the integration and provide its project directory:

```json
{
  "sparkDoctor": {
    "enabled": true,
    "directory": "$HOME/src/spark-doctor"
  }
}
```

At runtime, the dashboard verifies that the directory exists and that either `.venv/bin/spark-doctor` or a host-level `spark-doctor` executable is available. The action, health card, and findings panel remain hidden when detection fails. `SPARK_DOCTOR_ENABLED` and `SPARK_DOCTOR_DIRECTORY` can manage these settings through the environment.

## Write Authentication

Benchmark, Spark Doctor, and model-control requests are write operations. A write-enabled profile bound beyond loopback must set `security.controlToken` or `DASHBOARD_CONTROL_TOKEN`. The remote setup wizard generates this token automatically.

`security.allowUnauthenticatedControl: true` is an explicit escape hatch for a host already isolated by a trusted private-network policy. It is disabled by default and must never be used on a publicly reachable host.

## Environment Overrides

See `.env.example`. Secrets should be provided through the process environment, never committed JSON.
