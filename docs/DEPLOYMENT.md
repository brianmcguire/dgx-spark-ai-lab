# Deployment

## Local Service

```bash
npm ci
npm run setup
npm run doctor
npm run build
npm start
```

The default service listens only on `127.0.0.1:4174`.

The environment doctor treats unavailable inference endpoints as warnings in the read-only starter profile. In benchmark and full-control profiles, the OpenAI-compatible models endpoint is required and an unavailable endpoint causes the doctor to exit with a failure.

## PM2

```bash
npm install --global pm2
npm run build
npm run pm2:start
pm2 save
```

Use your operating system's PM2 startup integration if the dashboard must return after reboot.

## Private Remote Access

Bind to `0.0.0.0` only on a trusted host and use Tailscale ACLs or an equivalent private network policy. Set `DASHBOARD_CONTROL_TOKEN` whenever write capabilities are enabled. The server fails closed when an externally bound write-enabled profile has neither a token nor an explicit trusted-network exception.

## LiteLLM Gateway

The optional files in `examples/litellm/` demonstrate a stable application alias in front of a replaceable vLLM model. They are examples, not automatically installed services.
