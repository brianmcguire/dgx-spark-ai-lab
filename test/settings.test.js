import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveEditableSettings, settingsResponse } from "../server/settings.js";

function fixture(configuredPath) {
  return {
    configuredPath,
    dashboard: {
      title: "Local AI Operations Lab",
      brand: "AI Operations",
      subtitle: "Inference health and benchmarks.",
      logoUrl: "/dgx-spark-icon.png",
      logoAlt: "AI Operations profile",
      mode: "readonly",
      host: "127.0.0.1",
      port: 4174,
    },
    compute: { label: "Local host", connection: "local", host: "local" },
    inference: { apiUrl: "http://127.0.0.1:8000/v1", metricsUrl: "http://127.0.0.1:8000/metrics" },
    services: {
      pm2: { enabled: false, label: "PM2 services", connection: "local", host: "local" },
      gateway: { enabled: false, label: "LLM gateway", apiUrl: "http://127.0.0.1:4010/v1" },
    },
    sparkDoctor: { enabled: false, directory: "$HOME/src/spark-doctor" },
    security: { controlToken: "", allowUnauthenticatedControl: false },
    controller: { enabled: false, launchScript: "/protected/start.sh" },
  };
}

test("settings response exposes only safe editable fields", () => {
  const response = settingsResponse(fixture("/tmp/dashboard.local.json"), { HOST: "127.0.0.1" });
  assert.equal(response.values.dashboard.title, "Local AI Operations Lab");
  assert.equal(response.values.security, undefined);
  assert.equal(response.values.controller, undefined);
  assert.equal(response.values.sparkDoctor.enabled, false);
  assert.equal(response.managed["dashboard.host"], "HOST");
});

test("Spark Doctor settings reject shell-like paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-settings-spark-doctor-"));
  const config = fixture(join(directory, "dashboard.local.json"));
  const payload = settingsResponse(config, {}).values;
  payload.sparkDoctor.directory = "/tmp/spark doctor; echo unsafe";
  await assert.rejects(saveEditableSettings(config, payload, { env: {} }), /must be an absolute path/);
  await rm(directory, { recursive: true, force: true });
});

test("settings persistence preserves protected configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-settings-"));
  const configuredPath = join(directory, "dashboard.local.json");
  await writeFile(configuredPath, JSON.stringify({
    security: { controlToken: "secret" },
    controller: { enabled: true, launchScript: "/protected/start.sh" },
  }));
  const config = fixture(configuredPath);
  const payload = settingsResponse(config, {}).values;
  payload.dashboard.title = "My Inference Lab";
  const result = await saveEditableSettings(config, payload, { env: {} });
  const saved = JSON.parse(await readFile(configuredPath, "utf8"));
  assert.equal(result.restartRequired, true);
  assert.equal(saved.dashboard.title, "My Inference Lab");
  assert.equal(saved.security.controlToken, "secret");
  assert.equal(saved.controller.launchScript, "/protected/start.sh");
  await rm(directory, { recursive: true, force: true });
});

test("environment-managed settings cannot be overwritten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-settings-env-"));
  const configuredPath = join(directory, "dashboard.local.json");
  const config = fixture(configuredPath);
  const payload = settingsResponse(config, {}).values;
  payload.dashboard.host = "0.0.0.0";
  const result = await saveEditableSettings(config, payload, { env: { HOST: "127.0.0.1" } });
  const saved = JSON.parse(await readFile(configuredPath, "utf8"));
  assert.equal(result.values.dashboard.host, "127.0.0.1");
  assert.equal(saved.dashboard?.host, undefined);
  await rm(directory, { recursive: true, force: true });
});

test("settings validation rejects invalid values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-settings-invalid-"));
  const config = fixture(join(directory, "dashboard.local.json"));
  const payload = settingsResponse(config, {}).values;
  payload.services.pm2.enabled = "yes";
  await assert.rejects(saveEditableSettings(config, payload, { env: {} }), /must be true or false/);
  await rm(directory, { recursive: true, force: true });
});

test("write-enabled network dashboards require explicit protection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-lab-settings-security-"));
  const config = fixture(join(directory, "dashboard.local.json"));
  const payload = settingsResponse(config, {}).values;
  payload.dashboard.mode = "full";
  payload.dashboard.host = "0.0.0.0";
  await assert.rejects(saveEditableSettings(config, payload, { env: {} }), /requires a control token/);
  await rm(directory, { recursive: true, force: true });
});
