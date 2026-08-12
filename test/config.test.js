import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, loadModelCatalog, publicConfig } from "../server/config.js";

test("default profile is local and read-only", async () => {
  const previous = process.env.DASHBOARD_CONFIG;
  process.env.DASHBOARD_CONFIG = "config/does-not-exist.json";
  const config = await loadConfig();
  assert.equal(config.compute.connection, "local");
  assert.equal(config.capabilities.modelControl, false);
  assert.equal(config.capabilities.benchmarks, false);
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
