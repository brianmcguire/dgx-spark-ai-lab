import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const doctor = resolve(import.meta.dirname, "../scripts/doctor.mjs");

async function runDoctor(mode) {
  const directory = await mkdtemp(join(tmpdir(), "spark-ai-lab-doctor-"));
  const configPath = join(directory, "dashboard.json");
  await writeFile(configPath, JSON.stringify({
    profile: `test-${mode}`,
    dashboard: { mode },
    inference: {
      apiUrl: "http://127.0.0.1:1/v1",
      metricsUrl: "http://127.0.0.1:1/metrics",
    },
  }));
  try {
    return await execFileAsync(process.execPath, [doctor], {
      env: { ...process.env, DASHBOARD_CONFIG: configPath },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("doctor warns about optional endpoints in read-only mode", async () => {
  const { stdout } = await runDoctor("readonly");
  assert.match(stdout, /WARN  OpenAI models endpoint/);
  assert.match(stdout, /WARN  Inference metrics/);
});

test("doctor fails when the benchmark endpoint is unavailable", async () => {
  await assert.rejects(runDoctor("benchmark"), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /FAIL  OpenAI models endpoint/);
    assert.match(error.stdout, /WARN  Inference metrics/);
    return true;
  });
});
