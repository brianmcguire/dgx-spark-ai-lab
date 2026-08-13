import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "config/dashboard.local.json");
const modelCatalogDestination = resolve(root, "config/models.local.json");
const rl = createInterface({ input: stdin, output: stdout });

async function ask(question, fallback = "") {
  const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim();
  return answer || fallback;
}

async function main() {
  stdout.write("\nAI Operations Lab setup\n\n1. Local monitoring (read-only)\n2. Local inference benchmarking\n3. Remote DGX Spark with model control\n\n");
  const choice = await ask("Select a profile", "1");
  await mkdir(resolve(root, "config"), { recursive: true });

  if (choice === "1") {
    await copyFile(resolve(root, "config/default.json"), destination);
  } else if (choice === "2") {
    await copyFile(resolve(root, "config/local-benchmark.example.json"), destination);
  } else if (choice === "3") {
    const template = JSON.parse(await readFile(resolve(root, "config/remote-dgx.example.json"), "utf8"));
    const sshHost = await ask("SSH host or alias for the compute system", "dgx-spark");
    const inferenceHost = await ask("Hostname or IP serving vLLM", sshHost);
    const remoteHome = await ask("Remote user home", "/home/dgx");
    template.compute.host = sshHost;
    template.inference.apiUrl = `http://${inferenceHost}:8000/v1`;
    template.inference.metricsUrl = `http://${inferenceHost}:8000/metrics`;
    template.controller.home = remoteHome;
    template.controller.launchScript = `${remoteHome}/start-vllm.sh`;
    template.controller.paths.nativeRuntime = `${remoteHome}/venvs/vllm/bin/vllm`;
    template.controller.paths.nativeActivate = `${remoteHome}/venvs/vllm/bin/activate`;
    template.services.pm2.enabled = (await ask("Monitor local PM2 services? (yes/no)", "no")).toLowerCase().startsWith("y");
    template.services.gateway.enabled = (await ask("Monitor a local LiteLLM gateway? (yes/no)", "no")).toLowerCase().startsWith("y");
    template.security.controlToken = randomBytes(24).toString("base64url");
    await writeFile(destination, `${JSON.stringify(template, null, 2)}\n`, { mode: 0o600 });
    const discoverModels = (await ask("Show downloaded Hugging Face checkpoints that still need setup? (yes/no)", "yes")).toLowerCase().startsWith("y");
    if (discoverModels) {
      await writeFile(modelCatalogDestination, `${JSON.stringify({
        mode: "merge",
        discovery: { enabled: true, includeUnknown: true },
        initialPrimary: null,
        models: [],
      }, null, 2)}\n`, { mode: 0o600 });
    }
  } else {
    throw new Error("Profile selection must be 1, 2, or 3.");
  }

  stdout.write(`\nCreated ${destination}\n`);
  if (choice === "3") {
    stdout.write("A private dashboard control token was generated in that ignored configuration file.\n");
    stdout.write("The dashboard will adopt the model already served by vLLM as the initial primary. It will never activate a discovered checkpoint automatically.\n");
  }
  stdout.write("Run: npm run doctor\nThen: npm run dev\n");
}

try {
  await main();
} finally {
  rl.close();
}
