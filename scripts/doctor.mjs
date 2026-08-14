import { spawn, execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { loadConfig } from "../server/config.js";

const execFileAsync = promisify(execFile);
const config = await loadConfig();
const checks = [];

async function resolveVllmApiKey() {
  if (process.env.VLLM_API_KEY) return process.env.VLLM_API_KEY;
  const path = config.controller?.paths?.apiKey;
  if (!path) return "";
  try {
    if (config.compute.connection === "ssh") {
      const { stdout } = await execFileAsync("ssh", [
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=5",
        config.compute.host,
        "cat", path,
      ], { timeout: 5000 });
      return stdout.trim();
    }
    return (await readFile(path, "utf8")).trim();
  } catch {
    return "";
  }
}

async function httpCheck(label, url, headers = {}, { required = true } = {}) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    checks.push({ label, ok: response.ok, required, detail: `${response.status} ${url}` });
  } catch (error) {
    checks.push({ label, ok: false, required, detail: error.message });
  }
}

async function commandCheck(label, command, args) {
  await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
    child.on("error", (error) => {
      clearTimeout(timer);
      checks.push({ label, ok: false, detail: error.message });
      resolve();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      checks.push({ label, ok: code === 0, detail: `exit ${code}` });
      resolve();
    });
  });
}

checks.push({ label: "Configuration", ok: true, detail: `${config.profile} (${config.loadedFrom})` });
if (config.compute.connection === "ssh") {
  await commandCheck("Compute SSH", "ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", config.compute.host, "true"]);
} else {
  checks.push({ label: "Compute", ok: true, detail: "local" });
}
if (config.inference.apiUrl) {
  const apiKey = await resolveVllmApiKey();
  const headers = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};
  const inferenceRequired = config.dashboard.mode === "benchmark" || config.dashboard.mode === "full";
  await httpCheck("OpenAI models endpoint", `${config.inference.apiUrl}/models`, headers, { required: inferenceRequired });
}
if (config.inference.metricsUrl) await httpCheck("Inference metrics", config.inference.metricsUrl, {}, { required: false });
if (config.services.gateway.enabled) await httpCheck("LLM gateway", `${config.services.gateway.apiUrl}/models`);

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : check.required === false ? "WARN" : "FAIL"}  ${check.label}: ${check.detail}`);
}
if (checks.some((check) => !check.ok && check.required !== false)) process.exitCode = 1;
