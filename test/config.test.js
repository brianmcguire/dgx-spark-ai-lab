import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, loadModelCatalog, loadModelCatalogDefinition, publicConfig } from "../server/config.js";

test("default profile is local and read-only", async () => {
  const previous = process.env.DASHBOARD_CONFIG;
  process.env.DASHBOARD_CONFIG = "config/does-not-exist.json";
  const config = await loadConfig();
  assert.equal(config.compute.connection, "local");
  assert.equal(config.capabilities.modelControl, false);
  assert.equal(config.capabilities.benchmarks, false);
  assert.equal(config.dashboard.logoUrl, "/dgx-spark-icon.png");
  assert.equal(publicConfig(config).logoUrl, "/dgx-spark-icon.png");
  if (previous === undefined) delete process.env.DASHBOARD_CONFIG;
  else process.env.DASHBOARD_CONFIG = previous;
});

test("custom profile enables benchmark capability and public auth state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-config-"));
  const profile = join(directory, "profile.json");
  await writeFile(profile, JSON.stringify({ dashboard: { mode: "benchmark" }, security: { controlToken: "test-token" } }));
  const previous = process.env.DASHBOARD_CONFIG;
  process.env.DASHBOARD_CONFIG = profile;
  const config = await loadConfig();
  assert.equal(config.capabilities.benchmarks, true);
  assert.equal(publicConfig(config).controlAuthRequired, true);
  if (previous === undefined) delete process.env.DASHBOARD_CONFIG;
  else process.env.DASHBOARD_CONFIG = previous;
  await rm(directory, { recursive: true });
});

test("custom dashboard branding is exposed to the client", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-branding-"));
  const profile = join(directory, "profile.json");
  await writeFile(profile, JSON.stringify({
    dashboard: { logoUrl: "/custom-profile.png", logoAlt: "Custom lab profile" },
  }));
  const previous = process.env.DASHBOARD_CONFIG;
  process.env.DASHBOARD_CONFIG = profile;
  const config = await loadConfig();
  assert.equal(publicConfig(config).logoUrl, "/custom-profile.png");
  assert.equal(publicConfig(config).logoAlt, "Custom lab profile");
  if (previous === undefined) delete process.env.DASHBOARD_CONFIG;
  else process.env.DASHBOARD_CONFIG = previous;
  await rm(directory, { recursive: true });
});

test("model catalog merges overrides by key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-models-"));
  const catalogPath = join(directory, "models.json");
  await writeFile(catalogPath, JSON.stringify({ models: [{ key: "one", label: "Updated" }, { key: "two", label: "Added" }] }));
  const previous = process.env.MODEL_CATALOG_PATH;
  process.env.MODEL_CATALOG_PATH = catalogPath;
  const models = await loadModelCatalog([{ key: "one", label: "Original", repo: "example/one" }]);
  assert.deepEqual(models.map(({ key }) => key), ["one", "two"]);
  assert.equal(models[0].label, "Updated");
  assert.equal(models[0].repo, "example/one");
  if (previous === undefined) delete process.env.MODEL_CATALOG_PATH;
  else process.env.MODEL_CATALOG_PATH = previous;
  await rm(directory, { recursive: true });
});

test("model catalog exposes discovery settings and filters enabled recipes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-model-settings-"));
  const catalogPath = join(directory, "models.json");
  await writeFile(catalogPath, JSON.stringify({
    discovery: { enabled: true, includeUnknown: true },
    enabledKeys: ["two"],
    models: [{ key: "two", label: "Second" }],
  }));
  const previous = process.env.MODEL_CATALOG_PATH;
  process.env.MODEL_CATALOG_PATH = catalogPath;
  const definition = await loadModelCatalogDefinition([{ key: "one", label: "First" }]);
  assert.deepEqual(definition.models.map(({ key }) => key), ["two"]);
  assert.equal(definition.discovery.enabled, true);
  assert.equal(definition.discovery.includeUnknown, true);
  if (previous === undefined) delete process.env.MODEL_CATALOG_PATH;
  else process.env.MODEL_CATALOG_PATH = previous;
  await rm(directory, { recursive: true });
});

test("model catalog keeps history metadata separate from controller recipes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-history-models-"));
  const catalogPath = join(directory, "models.json");
  await writeFile(catalogPath, JSON.stringify({
    mode: "replace",
    models: [],
    historyModels: [{
      key: "retired-model",
      displayName: "Retired Model",
      providerLogo: "nvidia",
      repository: "example/controller-recipe",
      dockerArgs: "--controller-only",
    }],
  }));
  const previous = process.env.MODEL_CATALOG_PATH;
  process.env.MODEL_CATALOG_PATH = catalogPath;
  const definition = await loadModelCatalogDefinition([{ key: "active-model", label: "Active Model" }]);

  assert.deepEqual(definition.models, []);
  assert.deepEqual(definition.historyModels, [{
    key: "retired-model",
    id: "retired-model",
    servedNames: [],
    displayName: "Retired Model",
    provider: null,
    providerLogo: "nvidia",
  }]);
  assert.equal("repository" in definition.historyModels[0], false);
  assert.equal("dockerArgs" in definition.historyModels[0], false);

  if (previous === undefined) delete process.env.MODEL_CATALOG_PATH;
  else process.env.MODEL_CATALOG_PATH = previous;
  await rm(directory, { recursive: true });
});

test("environment variables override profile host and control token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-env-"));
  const profile = join(directory, "profile.json");
  await writeFile(profile, JSON.stringify({ dashboard: { host: "0.0.0.0" }, security: { controlToken: "profile-token" } }));
  const previous = {
    DASHBOARD_CONFIG: process.env.DASHBOARD_CONFIG,
    DASHBOARD_CONTROL_TOKEN: process.env.DASHBOARD_CONTROL_TOKEN,
    HOST: process.env.HOST,
  };
  process.env.DASHBOARD_CONFIG = profile;
  process.env.DASHBOARD_CONTROL_TOKEN = "environment-token";
  process.env.HOST = "127.0.0.1";
  const config = await loadConfig();
  assert.equal(config.dashboard.host, "127.0.0.1");
  assert.equal(config.security.controlToken, "environment-token");
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(directory, { recursive: true });
});

test("external write-enabled profiles fail closed without an explicit trust decision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-security-"));
  const profile = join(directory, "profile.json");
  await writeFile(profile, JSON.stringify({
    dashboard: { host: "0.0.0.0", mode: "benchmark" },
    security: { controlToken: "", allowUnauthenticatedControl: false },
  }));
  const previous = process.env.DASHBOARD_CONFIG;
  process.env.DASHBOARD_CONFIG = profile;
  await assert.rejects(loadConfig(), /require security\.controlToken/);
  if (previous === undefined) delete process.env.DASHBOARD_CONFIG;
  else process.env.DASHBOARD_CONFIG = previous;
  await rm(directory, { recursive: true });
});

test("trusted private networks can explicitly allow tokenless control", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-trusted-"));
  const profile = join(directory, "profile.json");
  await writeFile(profile, JSON.stringify({
    dashboard: { host: "0.0.0.0", mode: "benchmark" },
    security: { controlToken: "", trustedNetworkOnly: true, allowUnauthenticatedControl: true },
  }));
  const previous = process.env.DASHBOARD_CONFIG;
  process.env.DASHBOARD_CONFIG = profile;
  const config = await loadConfig();
  assert.equal(config.capabilities.benchmarks, true);
  assert.equal(publicConfig(config).trustedNetworkOnly, true);
  if (previous === undefined) delete process.env.DASHBOARD_CONFIG;
  else process.env.DASHBOARD_CONFIG = previous;
  await rm(directory, { recursive: true });
});
