import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const EDITABLE_PATHS = {
  "dashboard.title": "DASHBOARD_TITLE",
  "dashboard.brand": null,
  "dashboard.subtitle": null,
  "dashboard.logoUrl": "DASHBOARD_LOGO_URL",
  "dashboard.logoAlt": null,
  "dashboard.mode": "DASHBOARD_MODE",
  "dashboard.host": "HOST",
  "dashboard.port": "PORT",
  "compute.label": null,
  "compute.connection": "DGX_CONNECTION",
  "compute.host": "DGX_HOST",
  "inference.apiUrl": "VLLM_API_URL",
  "inference.metricsUrl": "VLLM_METRICS_URL",
  "services.pm2.enabled": "PM2_COLLECTOR_ENABLED",
  "services.pm2.label": null,
  "services.pm2.connection": null,
  "services.pm2.host": "MAC_MINI_HOST",
  "services.gateway.enabled": "GATEWAY_ENABLED",
  "services.gateway.label": null,
  "services.gateway.apiUrl": "AGENT_GATEWAY_API_URL",
  "sparkDoctor.enabled": "SPARK_DOCTOR_ENABLED",
  "sparkDoctor.directory": "SPARK_DOCTOR_DIRECTORY",
};

const MODE_VALUES = new Set(["readonly", "benchmark", "full"]);
const CONNECTION_VALUES = new Set(["local", "ssh"]);

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const keys = path.split(".");
  let target = object;
  for (const key of keys.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
      target[key] = {};
    }
    target = target[key];
  }
  target[keys.at(-1)] = value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isLoopbackHost(host) {
  return ["127.0.0.1", "::1", "localhost"].includes(String(host).trim().toLowerCase());
}

function requireString(value, label, { allowEmpty = false, max = 300 } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > max) {
    throw new Error(`${label} must be ${allowEmpty ? "a" : "a non-empty"} string of at most ${max} characters.`);
  }
  return value.trim();
}

function requireUrl(value, label, { allowEmpty = false } = {}) {
  const normalized = requireString(value, label, { allowEmpty, max: 2048 });
  if (!normalized && allowEmpty) return "";
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${label} must be a valid HTTP or HTTPS URL.`);
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  return normalized.replace(/\/$/, "");
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
}

function requireComputePath(value, label) {
  const normalized = requireString(value, label, { max: 1024 });
  if (!/^(?:\/|\$HOME\/|\$\{HOME\}\/)[A-Za-z0-9._/-]+$/.test(normalized)) {
    throw new Error(`${label} must be an absolute path or begin with $HOME, without spaces or shell metacharacters.`);
  }
  return normalized;
}

function validate(values, config) {
  const result = clone(values);
  result.dashboard.title = requireString(result.dashboard.title, "Dashboard title", { max: 100 });
  result.dashboard.brand = requireString(result.dashboard.brand, "Dashboard brand", { max: 60 });
  result.dashboard.subtitle = requireString(result.dashboard.subtitle, "Dashboard subtitle", { max: 180 });
  result.dashboard.logoUrl = requireString(result.dashboard.logoUrl, "Logo URL", { allowEmpty: true, max: 2048 });
  result.dashboard.logoAlt = requireString(result.dashboard.logoAlt, "Logo description", { max: 100 });
  if (!MODE_VALUES.has(result.dashboard.mode)) throw new Error("Dashboard mode is not supported.");
  result.dashboard.host = requireString(result.dashboard.host, "Dashboard host", { max: 255 });
  result.dashboard.port = Number(result.dashboard.port);
  if (!Number.isInteger(result.dashboard.port) || result.dashboard.port < 1 || result.dashboard.port > 65535) {
    throw new Error("Dashboard port must be between 1 and 65535.");
  }

  result.compute.label = requireString(result.compute.label, "Compute label", { max: 80 });
  if (!CONNECTION_VALUES.has(result.compute.connection)) throw new Error("Compute connection must be local or SSH.");
  result.compute.host = requireString(result.compute.host, "Compute host", { max: 255 });
  result.inference.apiUrl = requireUrl(result.inference.apiUrl, "Inference API URL");
  result.inference.metricsUrl = requireUrl(result.inference.metricsUrl, "Inference metrics URL", { allowEmpty: true });

  result.services.pm2.enabled = requireBoolean(result.services.pm2.enabled, "PM2 enabled");
  result.services.pm2.label = requireString(result.services.pm2.label, "PM2 label", { max: 80 });
  if (!CONNECTION_VALUES.has(result.services.pm2.connection)) throw new Error("PM2 connection must be local or SSH.");
  result.services.pm2.host = requireString(result.services.pm2.host, "PM2 host", { max: 255 });
  result.services.gateway.enabled = requireBoolean(result.services.gateway.enabled, "Gateway enabled");
  result.services.gateway.label = requireString(result.services.gateway.label, "Gateway label", { max: 80 });
  result.services.gateway.apiUrl = requireUrl(result.services.gateway.apiUrl, "Gateway API URL", { allowEmpty: true });
  result.sparkDoctor.enabled = requireBoolean(result.sparkDoctor.enabled, "Spark Doctor enabled");
  result.sparkDoctor.directory = requireComputePath(result.sparkDoctor.directory, "Spark Doctor directory");

  const protectedControl = config.security?.controlToken || config.security?.allowUnauthenticatedControl;
  if (result.dashboard.mode !== "readonly" && !isLoopbackHost(result.dashboard.host) && !protectedControl) {
    throw new Error("A non-loopback dashboard with controls enabled requires a control token. Configure DASHBOARD_CONTROL_TOKEN first or use readonly mode.");
  }
  return result;
}

export function editableSettings(config) {
  const output = {};
  for (const path of Object.keys(EDITABLE_PATHS)) setPath(output, path, getPath(config, path));
  return output;
}

export function managedSettings(env = process.env) {
  return Object.fromEntries(
    Object.entries(EDITABLE_PATHS)
      .filter(([, variable]) => variable && env[variable] !== undefined)
      .map(([path, variable]) => [path, variable]),
  );
}

export function settingsResponse(config, env = process.env) {
  return {
    values: editableSettings(config),
    managed: managedSettings(env),
    restartRequired: false,
  };
}

export async function saveEditableSettings(config, payload, { env = process.env } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Settings payload must be an object.");
  const current = editableSettings(config);
  const candidate = clone(current);
  const managed = managedSettings(env);
  for (const path of Object.keys(EDITABLE_PATHS)) {
    const incoming = getPath(payload, path);
    if (incoming !== undefined && !managed[path]) setPath(candidate, path, incoming);
  }
  const validated = validate(candidate, config);

  let local = {};
  try {
    local = JSON.parse(await readFile(config.configuredPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const path of Object.keys(EDITABLE_PATHS)) {
    if (!managed[path]) setPath(local, path, getPath(validated, path));
  }

  await mkdir(dirname(config.configuredPath), { recursive: true });
  const temporaryPath = `${config.configuredPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(local, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, config.configuredPath);

  const effective = clone(validated);
  for (const path of Object.keys(managed)) setPath(effective, path, getPath(current, path));
  return {
    values: effective,
    managed,
    restartRequired: true,
  };
}
