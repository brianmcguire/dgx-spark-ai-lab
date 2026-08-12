# Security Policy

## Supported Versions

Security updates are applied to the current `main` branch.

## Deployment Boundary

The default profile binds to `127.0.0.1` and disables write operations. Model replacement, process control, and benchmark requests are privileged operations. When those capabilities are enabled:

- keep the dashboard on a trusted private network such as Tailscale;
- set `DASHBOARD_CONTROL_TOKEN` to require bearer authentication for writes;
- do not expose the server directly to the public internet;
- use a dedicated, least-privileged SSH account where possible;
- review every custom model catalog entry because it contributes launch arguments.

The server refuses to start a non-loopback, write-enabled profile without a control token unless `security.allowUnauthenticatedControl` is explicitly enabled. That exception is intended only for deployments already isolated by Tailscale ACLs or an equivalent trusted-network policy.

The control token is never stored in committed configuration. The browser keeps an entered token in local storage on that device.

## Reporting a Vulnerability

Open a private GitHub security advisory in this repository. Do not include credentials, tokens, private hostnames, or complete production configuration in a public issue.
