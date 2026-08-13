import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function merge(base, override) {
  if (!isObject(base) || !isObject(override)) return override ?? base;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = isObject(value) && isObject(base[key]) ? merge(base[key], value) : value;
  }
  return result;
}

async function readJson(path, required = false) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (!required && error.code === "ENOENT") return {};
    throw new Error(`Unable to load dashboard configuration at ${path}: ${error.message}`);
  }
}

function envBoolean(name, fallback) {
  if (!(name in process.env)) return fallback;
  return ["1", "true", "yes", "on"].includes(String(process.env[name]).toLowerCase());
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function requireSafeName(value, label) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(value || ""))) {
    throw new Error(`${label} may contain only letters, numbers, dots, underscores, and hyphens.`);
  }
}

function requireAbsolutePath(value, label) {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(String(value || ""))) {
    throw new Error(`${label} must be an absolute path without spaces or shell metacharacters.`);
  }
}

function isLoopbackHost(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(host || "").toLowerCase());
}

export async function loadConfig() {
  const defaultPath = resolve(ROOT, "config/default.json");
  const configuredPath = process.env.DASHBOARD_CONFIG
    ? resolve(process.cwd(), process.env.DASHBOARD_CONFIG)
    : resolve(ROOT, "config/dashboard.local.json");
  const defaults = await readJson(defaultPath, true);
  const local = await readJson(configuredPath);
  const config = merge(defaults, local);

  config.dashboard.host = process.env.HOST || config.dashboard.host;
  config.dashboard.port = envNumber("PORT", config.dashboard.port);
  config.dashboard.mode = process.env.DASHBOARD_MODE || config.dashboard.mode;
  config.dashboard.title = process.env.DASHBOARD_TITLE || config.dashboard.title;
  config.dashboard.logoUrl = process.env.DASHBOARD_LOGO_URL || config.dashboard.logoUrl || "/dgx-spark-icon.png";
  config.dashboard.logoAlt = config.dashboard.logoAlt || `${config.dashboard.brand || config.dashboard.title} profile`;
  config.compute.host = process.env.DGX_HOST || config.compute.host;
  config.compute.connection = process.env.DGX_CONNECTION || config.compute.connection;
  config.services.pm2.host = process.env.MAC_MINI_HOST || config.services.pm2.host;
  config.services.pm2.enabled = envBoolean("PM2_COLLECTOR_ENABLED", config.services.pm2.enabled);
  config.services.gateway.enabled = envBoolean("GATEWAY_ENABLED", config.services.gateway.enabled);
  config.services.gateway.apiUrl = process.env.AGENT_GATEWAY_API_URL || config.services.gateway.apiUrl;
  config.inference.apiUrl = process.env.VLLM_API_URL || config.inference.apiUrl;
  config.inference.metricsUrl = process.env.VLLM_METRICS_URL || config.inference.metricsUrl;
  config.controller.enabled = envBoolean("MODEL_CONTROLLER_ENABLED", config.controller.enabled);
  config.controller.port = envNumber("MODEL_CONTROLLER_PORT", config.controller.port);
  config.sparkDoctor.enabled = envBoolean("SPARK_DOCTOR_ENABLED", config.sparkDoctor.enabled);
  config.sparkDoctor.directory = process.env.SPARK_DOCTOR_DIRECTORY || config.sparkDoctor.directory;
  config.security.controlToken = process.env.DASHBOARD_CONTROL_TOKEN || config.security.controlToken || "";
  config.paths.data = process.env.DASHBOARD_DATA_DIR || config.paths.data;

  config.inference.apiUrl = String(config.inference.apiUrl || "").replace(/\/$/, "");
  config.services.gateway.apiUrl = String(config.services.gateway.apiUrl || "").replace(/\/$/, "");
  if (["$HOME", "${HOME}"].includes(config.controller.home)) config.controller.home = process.env.HOME;
  config.controller.launchScript ||= `${config.controller.home}/start-vllm.sh`;
  config.controller.paths = {
    cache: `${config.controller.home}/.cache/huggingface/hub`,
    apiKey: `${config.controller.home}/.config/vllm/api-key`,
    media: `${config.controller.home}/vllm-media`,
    pm2Logs: `${config.controller.home}/.pm2/logs`,
    nativeRuntime: `${config.controller.home}/venvs/vllm/bin/vllm`,
    nativeActivate: `${config.controller.home}/venvs/vllm/bin/activate`,
    legacyRuntime: `${config.controller.home}/venvs/hf/bin/vllm`,
    legacyActivate: `${config.controller.home}/venvs/hf/bin/activate`,
    chatTemplate: `${config.controller.home}/qwen36-nothink.jinja`,
    ffmpegLibraries: `${config.controller.home}/opt/ffmpeg/usr/lib/aarch64-linux-gnu`,
    ...config.controller.paths,
  };
  if (config.controller.enabled) {
    requireSafeName(config.controller.serviceName, "controller.serviceName");
    requireSafeName(config.controller.containerName, "controller.containerName");
    requireAbsolutePath(config.controller.home, "controller.home");
    requireAbsolutePath(config.controller.launchScript, "controller.launchScript");
    Object.entries(config.controller.paths).forEach(([key, value]) => requireAbsolutePath(value, `controller.paths.${key}`));
  }
  if (config.sparkDoctor.enabled) {
    const sparkDoctorDirectory = String(config.sparkDoctor.directory || "")
      .replaceAll("$HOME", config.controller.home)
      .replaceAll("${HOME}", config.controller.home);
    requireAbsolutePath(sparkDoctorDirectory, "sparkDoctor.directory");
  }
  const sparkDoctorConfigured = config.dashboard.mode === "full" && Boolean(config.sparkDoctor.enabled);
  config.capabilities = {
    localCollection: config.compute.connection === "local",
    sshCollection: config.compute.connection === "ssh",
    nvidiaTelemetry: Boolean(config.compute.nvidiaTelemetry),
    pm2: Boolean(config.services.pm2.enabled),
    gateway: Boolean(config.services.gateway.enabled),
    modelControl: config.dashboard.mode === "full" && Boolean(config.controller.enabled),
    sparkDoctor: false,
    sparkDoctorConfigured,
    benchmarks: config.dashboard.mode !== "readonly" && Boolean(config.inference.apiUrl),
  };
  const writesEnabled = config.capabilities.modelControl
    || config.capabilities.sparkDoctorConfigured
    || config.capabilities.benchmarks;
  if (
    writesEnabled
    && !config.security.controlToken
    && !isLoopbackHost(config.dashboard.host)
    && !config.security.allowUnauthenticatedControl
  ) {
    throw new Error(
      "Write capabilities on a non-loopback address require security.controlToken. "
      + "Set DASHBOARD_CONTROL_TOKEN, or explicitly set security.allowUnauthenticatedControl=true "
      + "only when access is restricted by a trusted private network.",
    );
  }
  config.loadedFrom = local && Object.keys(local).length ? configuredPath : defaultPath;
  config.configuredPath = configuredPath;
  return config;
}

export async function loadModelCatalogDefinition(builtInModels = []) {
  const configuredPath = process.env.MODEL_CATALOG_PATH
    ? resolve(process.cwd(), process.env.MODEL_CATALOG_PATH)
    : resolve(ROOT, "config/models.local.json");
  const catalog = await readJson(configuredPath);
  const customModels = Array.isArray(catalog) ? catalog : catalog.models;
  let models = builtInModels;
  if (Array.isArray(customModels) && customModels.length > 0) {
    if (catalog.mode === "replace") {
      models = customModels;
    } else {
      const byKey = new Map(builtInModels.map((model) => [model.key, model]));
      customModels.forEach((model) => byKey.set(model.key, merge(byKey.get(model.key) || {}, model)));
      models = [...byKey.values()];
    }
  }

  const enabledKeys = Array.isArray(catalog.enabledKeys) ? new Set(catalog.enabledKeys) : null;
  if (enabledKeys?.size) models = models.filter((model) => enabledKeys.has(model.key));

  return {
    models,
    discovery: {
      enabled: Boolean(catalog.discovery?.enabled),
      includeUnknown: catalog.discovery?.includeUnknown !== false,
    },
    initialPrimary: typeof catalog.initialPrimary === "string" ? catalog.initialPrimary : null,
    loadedFrom: Object.keys(catalog).length ? configuredPath : null,
  };
}

export async function loadModelCatalog(builtInModels = []) {
  return (await loadModelCatalogDefinition(builtInModels)).models;
}

export function publicConfig(config) {
  return {
    schemaVersion: config.schemaVersion,
    profile: config.profile,
    title: config.dashboard.title,
    brand: config.dashboard.brand,
    logoUrl: config.dashboard.logoUrl,
    logoAlt: config.dashboard.logoAlt,
    subtitle: config.dashboard.subtitle,
    mode: config.dashboard.mode,
    compute: {
      label: config.compute.label,
      host: config.compute.connection === "local" ? "local" : config.compute.host,
      connection: config.compute.connection,
    },
    services: {
      pm2: { enabled: config.services.pm2.enabled, label: config.services.pm2.label },
      gateway: { enabled: config.services.gateway.enabled, label: config.services.gateway.label },
    },
    capabilities: config.capabilities,
    controlAuthRequired: Boolean(config.security.controlToken) && Boolean(
      config.capabilities.modelControl
      || config.capabilities.benchmarks
      || config.capabilities.sparkDoctorConfigured
    ),
    trustedNetworkOnly: Boolean(config.security.trustedNetworkOnly),
  };
}
