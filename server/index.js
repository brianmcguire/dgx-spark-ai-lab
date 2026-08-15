import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, resolve } from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { loadConfig, loadModelCatalogDefinition, publicConfig } from "./config.js";
import { buildCatalogModels, buildDiscoveredModels } from "./model-discovery.js";
import { normalizeLatencyHistory, normalizeLatencyRecord } from "./latency-history.js";
import { redactSensitiveData } from "./redaction.js";
import { saveEditableSettings, settingsResponse } from "./settings.js";
import { staticResponseHeaders } from "./static-cache.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONFIG = await loadConfig();
const PORT = CONFIG.dashboard.port;
const HOST = CONFIG.dashboard.host;
const DGX_HOST = CONFIG.compute.host;
const MAC_MINI_HOST = CONFIG.services.pm2.host;
const DATA_DIR = isAbsolute(CONFIG.paths.data) ? CONFIG.paths.data : resolve(ROOT, CONFIG.paths.data);
const DIST = join(ROOT, "dist");
const HISTORY_PATH = join(DATA_DIR, "health-history.json");
const HISTORY_DB_PATH = join(DATA_DIR, "health-history.sqlite");
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT || 1440);
const HISTORY_RETENTION_DAYS = Number(process.env.HISTORY_RETENTION_DAYS || 90);
const HF_CACHE_TTL_MS = Number(process.env.HF_CACHE_TTL_MS || 60 * 60 * 1000);
const VLLM_METRICS_URL = CONFIG.inference.metricsUrl;
const VLLM_API_URL = CONFIG.inference.apiUrl;
let VLLM_API_KEY = process.env.VLLM_API_KEY || "";
const AGENT_GATEWAY_API_URL = CONFIG.services.gateway.apiUrl;
const VLLM_LIVE_POLL_INTERVAL_MS = Number(process.env.VLLM_LIVE_POLL_INTERVAL_MS || 5000);
const SYNTHETIC_PROBE_INTERVAL_MS = Number(process.env.SYNTHETIC_PROBE_INTERVAL_MS || 10 * 60 * 1000);
const LATENCY_HISTORY_PATH = join(DATA_DIR, "latency-runs.json");
const LATENCY_HISTORY_LIMIT = Number(process.env.LATENCY_HISTORY_LIMIT || 250);
const CONTROLLER_HOME = CONFIG.controller.home;
const CONTROLLER_PATHS = CONFIG.controller.paths;
const MODEL_SERVICE_NAME = CONFIG.controller.serviceName;
const MODEL_CONTAINER_NAME = CONFIG.controller.containerName;
const MODEL_CONTROLLER_PORT = CONFIG.controller.port;
const MODEL_LAUNCH_SCRIPT = CONFIG.controller.launchScript;
const MODEL_BACKUP_SCRIPT = `${MODEL_LAUNCH_SCRIPT}.last-known-good`;
const MODEL_OUT_LOG = `${CONTROLLER_PATHS.pm2Logs}/${MODEL_SERVICE_NAME}-out.log`;
const MODEL_ERROR_LOG = `${CONTROLLER_PATHS.pm2Logs}/${MODEL_SERVICE_NAME}-error.log`;
const SPARK_DOCTOR_DIRECTORY = computePath(CONFIG.sparkDoctor.directory);

function computePath(path) {
  return String(path || "")
    .replaceAll("$HOME", CONTROLLER_HOME)
    .replaceAll("${HOME}", CONTROLLER_HOME);
}

await mkdir(DATA_DIR, { recursive: true });
const historyDb = new DatabaseSync(HISTORY_DB_PATH);
historyDb.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS telemetry_samples (
    collected_at TEXT PRIMARY KEY,
    model_key TEXT,
    model_id TEXT,
    model_label TEXT,
    model_switch INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS telemetry_samples_model_time
    ON telemetry_samples(model_key, collected_at);
`);

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])));
  return Buffer.concat([length, typeBytes, payload, checksum]);
}

function buildVisualBenchmarkImageDataUrl() {
  const width = 480;
  const height = 320;
  const pixels = Buffer.alloc(width * height * 4);
  const drawPixel = (x, y, color) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = 255;
  };
  const fillRect = (left, top, rectWidth, rectHeight, color) => {
    for (let y = top; y < top + rectHeight; y += 1) {
      for (let x = left; x < left + rectWidth; x += 1) drawPixel(x, y, color);
    }
  };
  const fillCircle = (centerX, centerY, radius, color) => {
    for (let y = centerY - radius; y <= centerY + radius; y += 1) {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) drawPixel(x, y, color);
      }
    }
  };
  const fillTriangle = (topX, topY, baseY, halfWidth, color) => {
    for (let y = topY; y <= baseY; y += 1) {
      const progress = (y - topY) / (baseY - topY);
      const widthAtY = Math.round(halfWidth * progress);
      for (let x = topX - widthAtY; x <= topX + widthAtY; x += 1) drawPixel(x, y, color);
    }
  };

  fillRect(0, 0, width, height, [11, 22, 29]);
  fillRect(42, 38, 112, 76, [46, 210, 190]);
  fillRect(326, 38, 112, 76, [246, 202, 75]);
  fillCircle(240, 154, 49, [236, 98, 126]);
  fillTriangle(118, 202, 278, 76, [109, 149, 255]);
  fillRect(316, 218, 102, 62, [141, 216, 98]);

  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 4 + 1);
    scanlines[target] = 0;
    pixels.copy(scanlines, target + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function buildLongContextReviewPrompt() {
  const module = `
export async function processOrder(input: OrderInput, dependencies: Dependencies) {
  const order = await dependencies.orders.find(input.orderId);
  if (!order) return { status: "not_found" as const };
  const feature = await dependencies.flags.resolve("new-pricing", input.accountId);
  const amount = feature ? calculateNewPrice(order.items, input.coupon) : calculateLegacyPrice(order.items);
  const event = { type: "order.processed", orderId: order.id, amount, metadata: input.metadata };
  dependencies.logger.info({ orderId: order.id, accountId: input.accountId }, "processing order");
  await dependencies.events.publish(event);
  return { status: "processed" as const, amount };
}

export function calculateNewPrice(items: Item[], coupon?: string) {
  const subtotal = items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
  return coupon === "SAVE10" ? subtotal * 0.9 : subtotal;
}

export function serializeAuditRecord(record: AuditRecord) {
  return JSON.stringify({ id: record.id, createdAt: record.createdAt, actor: record.actor, payload: record.payload });
}
`;
  const repository = Array.from({ length: 30 }, (_, index) => `### packages/service-${String(index + 1).padStart(2, "0")}/src/order.ts\n${module}`).join("\n");
  return `You are reviewing a TypeScript monorepo before a production release. Identify the five highest-risk correctness, security, and reliability issues. For each, name the affected file, explain the impact, and show a narrowly scoped fix plus one regression test. Prioritize findings; do not rewrite the entire repository.\n\n${repository}`;
}

const VISUAL_BENCHMARK_IMAGE_DATA_URL = buildVisualBenchmarkImageDataUrl();

function vllmHeaders(headers = {}) {
  return VLLM_API_KEY
    ? { ...headers, authorization: `Bearer ${VLLM_API_KEY}` }
    : headers;
}

async function runAgentGatewayCompatibilityProbe() {
  const response = await fetch(`${AGENT_GATEWAY_API_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "spark-production",
      messages: [{ role: "user", content: "Call the ping function with value ready." }],
      tools: [{
        type: "function",
        function: {
          name: "ping",
          description: "Returns a supplied value.",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
        },
      }],
      tool_choice: "auto",
      max_tokens: 256,
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(120000),
  });
  const payload = await response.json().catch(() => null);
  const toolCalls = payload?.choices?.[0]?.message?.tool_calls;
  if (!response.ok || !Array.isArray(toolCalls) || toolCalls.length === 0) {
    const detail = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`OpenClaw/Hermes gateway compatibility probe failed: ${detail}`);
  }
  return { ok: true, model: payload?.model || "spark-production" };
}

const CODING_PROMPTS = {
  quick: {
    label: "Quick code edit",
    detail: "Small implementation task, 256 output tokens.",
    maxTokens: 256,
    prompt: "In TypeScript, implement a concise isValidEmail(value: string): boolean utility. Explain the edge cases in two bullets after the code.",
  },
  standard: {
    label: "Standard review",
    detail: "Practical refactor and test plan, 512 output tokens.",
    maxTokens: 512,
    prompt: "You are reviewing a Node.js API handler that accepts JSON, calls an upstream service, and returns JSON. Propose a compact refactor that adds input validation, a request timeout, and useful error responses. Include TypeScript code and focused tests.",
  },
  intensive: {
    label: "Agentic refactor",
    detail: "Multi-step coding task, 1024 output tokens.",
    maxTokens: 1024,
    prompt: "Design and implement a small TypeScript rate limiter for an API gateway. It must use a token-bucket strategy, be safe for concurrent async calls, expose an allow(key) method, and include a focused test matrix. State assumptions, then provide production-oriented code and tests.",
  },
  debug: {
    label: "Debug and test repair",
    detail: "Failure triage, minimal patch, and regression coverage, 768 output tokens.",
    maxTokens: 768,
    prompt: "A TypeScript API intermittently returns duplicate invoices. The handler retries a payment-provider request after a timeout, but the idempotency key is generated inside the retry loop. Diagnose the defect, provide the smallest production-safe patch, and write focused tests for timeout, retry, and duplicate-request behavior.",
  },
  structured: {
    label: "Structured JSON / tool contract",
    detail: "Strict machine-readable output and schema design, 512 output tokens.",
    maxTokens: 512,
    prompt: "Design a TypeScript tool contract for creating a support ticket. Return a JSON object only with keys: schema, validationRules, handlerOutline, and tests. The schema must require title, severity, and requesterEmail; accept an optional productArea; reject unknown keys; and make retries idempotent.",
  },
  feature: {
    label: "Multi-file feature",
    detail: "Typed API feature spanning validation, persistence, and tests, 1024 output tokens.",
    maxTokens: 1024,
    prompt: "Implement a TypeScript feature to invite a user to a workspace. Describe the changes across route.ts, invite-service.ts, invite-repository.ts, and invite-service.test.ts. Include request validation, duplicate-pending-invite handling, an expiration time, an audit event, and focused tests. Use concise production-oriented code snippets for each file.",
  },
  longContext: {
    label: "Long-context code review",
    detail: "Repository-scale review with a fixed large prompt, 768 output tokens.",
    maxTokens: 768,
    prompt: buildLongContextReviewPrompt(),
  },
};

const CODING_BENCHMARK_SUITES = {
  standardCodingV1: {
    label: "Standard Coding Comparison v1",
    shortLabel: "Standard suite",
    description: "Five fixed coding workloads, including a two-stream concurrency case.",
    cases: [
      { id: "quick-edit", label: "Quick code edit", profile: "quick", maxTokens: 256, parallel: 1 },
      { id: "standard-review", label: "Standard review", profile: "standard", maxTokens: 512, parallel: 1 },
      { id: "debug-repair", label: "Debug and test repair", profile: "debug", maxTokens: 768, parallel: 1 },
      { id: "agentic-refactor", label: "Agentic refactor", profile: "intensive", maxTokens: 1024, parallel: 1 },
      { id: "concurrency-2x", label: "Standard review · 2 streams", profile: "standard", maxTokens: 512, parallel: 2 },
    ],
  },
};

const VISUAL_PROMPTS = {
  extraction: {
    label: "Image extraction",
    detail: "Fixed synthetic image with object counts and attributes, 256 output tokens.",
    maxTokens: 256,
    prompt: "Inspect the attached synthetic benchmark image. Return a JSON object only with these keys: shapeCount, shapes, centerShape, topRightColor, bottomLeftShape, and greenShapePosition. List shapes from top to bottom, then left to right. Each shape must include type, color, and approximate position.",
  },
  reasoning: {
    label: "Visual reasoning",
    detail: "Fixed synthetic image with relational and spatial reasoning, 512 output tokens.",
    maxTokens: 512,
    prompt: "Inspect the attached synthetic benchmark image. Answer concisely: 1) Which shape is centered between the two top rectangles? 2) Which two shapes occupy the lower half? 3) Is the green rectangle to the left or right of the blue triangle? 4) Give the full count by shape type and color. Explain only what is visible.",
  },
};

// Benchmarks recorded before the lab filtered application aliases should retain
// the canonical checkpoint name, even though applications still use this alias.
const LEGACY_LATENCY_MODEL_ALIASES = new Map([
  ["qwen3-14b", "qwen3.6-35b-a3b-nvfp4"],
]);

const BUILTIN_DGX_MODEL_CATALOG = [
  {
    key: "redhat-qwen36-35b-nvfp4",
    label: "Qwen 3.6 35B A3B NVFP4",
    provider: "Red Hat AI",
    providerLogo: "qwen",
    repository: "RedHatAI/Qwen3.6-35B-A3B-NVFP4",
    cacheDirectory: "models--RedHatAI--Qwen3.6-35B-A3B-NVFP4",
    servedNames: ["qwen3-14b", "qwen3.6-35b-a3b-nvfp4"],
    precision: "NVFP4",
    parameters: "35B total · 3B active",
    architecture: "MoE · hybrid attention",
    checkpointSize: "24 GB on Spark",
    bestFor: "Production reasoning, tools, and general agents",
    context: "131K",
    kvCache: "8 GB",
    status: "ready",
    description: "Current production-compatible general, reasoning, and tool-calling model.",
    speculativeConfig: '{"method": "qwen3_5_mtp", "num_speculative_tokens": 1}',
  },
  {
    key: "qwen38-27b-bf16",
    label: "Qwen 3.8 27B BF16",
    provider: "Qwen",
    providerLogo: "qwen",
    repository: "Qwen/Qwen3.8-27B",
    cacheDirectory: "models--Qwen--Qwen3.8-27B",
    servedNames: ["qwen3-14b", "qwen3.8-27b"],
    precision: "BF16",
    parameters: "27B dense",
    architecture: "Gated DeltaNet hybrid transformer",
    checkpointSize: "55.6 GB download",
    bestFor: "Coding, research, professional work, and multimodal agents",
    context: "65K configured · 262K native",
    kvCache: "8 GB",
    status: "staged",
    modalities: "Text, image, video",
    description: "Qwen's dense Qwen 3.8 model with flexible thinking control, native vision-language support, and strong long-horizon agent capabilities.",
    runtime: "docker",
    dockerImage: "vllm/vllm-openai:v0.27.1",
    maxModelLen: 65536,
    maxNumSeqs: 32,
    startupTimeoutSeconds: 1500,
    readinessProbe: "text",
    dockerArgs: "--trust-remote-code --gpu-memory-utilization 0.60 --kv-cache-dtype fp8 --reasoning-parser qwen3 --enable-auto-tool-choice --tool-call-parser qwen3_coder --default-chat-template-kwargs '{\"enable_thinking\": false}'",
  },
  {
    key: "unsloth-qwen38-27b-nvfp4",
    label: "Qwen 3.8 27B NVFP4",
    provider: "Unsloth",
    providerLogo: "qwen",
    repository: "unsloth/Qwen3.8-27B-NVFP4",
    cacheDirectory: "models--unsloth--Qwen3.8-27B-NVFP4",
    servedNames: ["qwen3-14b", "qwen3.8-27b-nvfp4"],
    precision: "NVFP4 / FP8 mixed",
    parameters: "27B dense",
    architecture: "Gated DeltaNet hybrid transformer",
    checkpointSize: "23.4 GB download",
    bestFor: "Efficient coding, research, professional work, and multimodal agents",
    context: "65K configured · 262K native",
    kvCache: "8 GB FP8",
    status: "staged",
    modalities: "Text, image, video",
    description: "Unsloth Dynamic v3 preview quantization of Qwen 3.8, retaining higher precision for sensitive layers while reducing Spark memory and bandwidth pressure.",
    runtime: "docker",
    dockerImage: "vllm/vllm-openai:v0.27.1",
    maxModelLen: 65536,
    maxNumSeqs: 4,
    startupTimeoutSeconds: 1500,
    readinessProbe: "text",
    dockerArgs: "--trust-remote-code --gpu-memory-utilization 0.60 --kv-cache-dtype fp8 --reasoning-parser qwen3 --enable-auto-tool-choice --tool-call-parser qwen3_coder --default-chat-template-kwargs '{\"enable_thinking\": false}' --enable-prefix-caching --enable-chunked-prefill --speculative-config '{\"method\":\"mtp\",\"num_speculative_tokens\":3}'",
  },
  {
    key: "nvidia-qwen36-27b-nvfp4",
    label: "Qwen 3.6 27B NVFP4",
    provider: "NVIDIA",
    providerLogo: "qwen",
    repository: "nvidia/Qwen3.6-27B-NVFP4",
    cacheDirectory: "models--nvidia--Qwen3.6-27B-NVFP4",
    readyMarker: `${CONTROLLER_HOME}/.local/share/spark-models/qwen3-6-27b-nvfp4.ready`,
    servedNames: ["qwen3-14b", "qwen3.6-27b-nvfp4"],
    precision: "NVFP4",
    parameters: "27B dense",
    architecture: "Hybrid transformer",
    checkpointSize: "21 GB on Spark",
    bestFor: "Multimodal agents, RAG, and general development",
    context: "131K",
    kvCache: "8 GB",
    status: "ready",
    modalities: "Text, image, video",
    description: "Smaller NVIDIA-optimized Qwen alternative for multimodal development, agentic tasks, and controlled production comparisons.",
    runtime: "docker",
    dockerImage: "vllm/vllm-openai:nightly",
    // This hybrid Qwen architecture uses a Mamba cache. With the 8 GB KV
    // allocation, vLLM reports 167 cache blocks, so its default 256 streams
    // cannot complete CUDA graph capture.
    maxNumSeqs: 128,
    dockerArgs: "--quantization modelopt --reasoning-parser qwen3 --enable-auto-tool-choice --tool-call-parser qwen3_xml",
  },
  {
    key: "nvidia-gemma4-26b-a4b-nvfp4",
    label: "Gemma 4 26B A4B NVFP4",
    provider: "Google DeepMind / NVIDIA",
    providerLogo: "google",
    repository: "nvidia/Gemma-4-26B-A4B-NVFP4",
    cacheDirectory: "models--nvidia--Gemma-4-26B-A4B-NVFP4",
    readyMarker: `${CONTROLLER_HOME}/.local/share/spark-models/gemma4-26b-a4b-nvfp4.ready`,
    servedNames: ["qwen3-14b", "gemma4-26b-a4b-nvfp4"],
    precision: "NVFP4",
    parameters: "25.2B total · 3.8B active",
    architecture: "MoE transformer",
    checkpointSize: "18 GB on Spark",
    bestFor: "Image understanding, coding, and function calling",
    context: "131K",
    kvCache: "8 GB",
    status: "ready",
    modalities: "Text, image, video frames",
    description: "Efficient 26B MoE multimodal alternative for image extraction, coding, reasoning, and video-frame analysis.",
    runtime: "docker",
    // The Gemma-specific image was unable to load this Model Optimizer NVFP4
    // checkpoint on the Spark. Use the current CUDA 13 vLLM image instead.
    dockerImage: "vllm/vllm-openai:latest-cu130",
    // Gemma's multimodal encoder reserves up to 2,496 tokens per item. Newer
    // vLLM rejects the default 2,048-token batch budget before startup.
    dockerArgs: "--max-num-batched-tokens 4096 --tool-call-parser gemma4 --reasoning-parser gemma4 --enable-auto-tool-choice --trust-remote-code",
  },
  {
    key: "nvidia-nemotron-3-nano-omni-30b-a3b-reasoning-nvfp4",
    label: "Nemotron 3 Nano Omni 30B A3B Reasoning",
    provider: "NVIDIA",
    providerLogo: "nvidia",
    repository: "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4",
    cacheDirectory: "models--nvidia--Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4",
    readyMarker: `${CONTROLLER_HOME}/.local/share/spark-models/nemotron-3-nano-omni-30b-a3b-reasoning-nvfp4.ready`,
    servedNames: ["qwen3-14b", "nemotron-3-nano-omni-30b"],
    precision: "NVFP4",
    parameters: "31B total · ~3B active",
    architecture: "Mamba2-transformer MoE",
    checkpointSize: "21 GB on Spark",
    bestFor: "Video, audio, document, OCR, and GUI agents",
    context: "131K",
    kvCache: "8 GB",
    status: "ready",
    modalities: "Text, image, video, audio",
    description: "Multimodal NVIDIA model for controlled image, video, document, and audio analysis. Replaces the primary model only when explicitly started.",
    chatTemplate: false,
    enableToolChoice: false,
    readinessProbe: "text",
    extraVllmArgs: `--tensor-parallel-size 1 --trust-remote-code --video-pruning-rate 0.5 --max-num-seqs 32 --allowed-local-media-path ${CONTROLLER_PATHS.media} --media-io-kwargs '{"video": {"fps": 2, "num_frames": 128}}'`,
  },
  {
    key: "nvidia-nemotron-35-lightning-30b-a3b-nvfp4",
    label: "Nemotron 3.5 Lightning 30B A3B",
    provider: "NVIDIA",
    providerLogo: "nvidia",
    repository: "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4",
    cacheDirectory: "models--nvidia--NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4",
    servedNames: ["qwen3-14b", "nemotron-3.5-lightning-30b-a3b"],
    precision: "NVFP4",
    parameters: "30B total · 3B active",
    architecture: "Mamba2-transformer MoE",
    checkpointSize: "21.6 GB + 1.35 GB DSpark",
    bestFor: "Always-on text agents, coding, tools, and high-throughput tasks",
    context: "65K",
    kvCache: "8 GB",
    status: "staged",
    modalities: "Text",
    description: "NVIDIA's high-throughput text and agent model with a DGX Spark-specific speculative decoder. It complements, rather than replaces, Omni's image, video, and audio capabilities.",
    runtime: "docker",
    dockerImage: "vllm/vllm-openai:v0.27.1",
    maxModelLen: 65536,
    startupTimeoutSeconds: 900,
    dockerArgs: "--gpu-memory-utilization 0.60 --moe-backend marlin --kv-cache-dtype fp8 --enable-prefix-caching --speculative_config.model nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DSpark --speculative_config.num_speculative_tokens 3 --mamba-backend flashinfer --mamba-cache-mode align --reasoning-parser nemotron_v3 --enable-auto-tool-choice --tool-call-parser qwen3_coder",
  },
  {
    key: "poolside-laguna-xs-21-nvfp4",
    label: "Laguna XS 2.1 NVFP4",
    provider: "Poolside",
    providerLogo: "poolside",
    repository: "poolside/Laguna-XS-2.1-NVFP4",
    cacheDirectory: "models--poolside--Laguna-XS-2.1-NVFP4",
    readyMarker: `${CONTROLLER_HOME}/.local/share/spark-models/laguna-xs-2-1-nvfp4.ready`,
    servedNames: ["qwen3-14b", "laguna-xs-2-1-nvfp4"],
    precision: "NVFP4",
    parameters: "33B total · 3B active",
    architecture: "MoE · SWA + global attention",
    checkpointSize: "21 GB on Spark",
    bestFor: "Fast local coding agents and coding benchmarks",
    context: "131K",
    kvCache: "8 GB",
    status: "staged",
    modalities: "Text",
    description: "Poolside 33B MoE coding and agentic model with 3B active parameters. Staged for controlled code-generation benchmarks and primary-model evaluation.",
    chatTemplate: false,
    enableToolChoice: false,
    extraVllmArgs: "--trust-remote-code --enable-auto-tool-choice --tool-call-parser poolside_v1 --reasoning-parser poolside_v1",
  },
  {
    key: "poolside-laguna-s-21-nvfp4",
    label: "Laguna S 2.1 NVFP4",
    provider: "Poolside",
    providerLogo: "poolside",
    repository: "poolside/Laguna-S-2.1-NVFP4",
    cacheDirectory: "models--poolside--Laguna-S-2.1-NVFP4",
    readyMarker: `${CONTROLLER_HOME}/.local/share/spark-models/laguna-s-2-1-nvfp4.ready`,
    servedNames: ["qwen3-14b", "laguna-s-2-1-nvfp4"],
    precision: "NVFP4",
    parameters: "117.6B total · 8.5B active",
    architecture: "MoE · SWA + global attention",
    checkpointSize: "67 GB on Spark",
    bestFor: "Highest-quality long-horizon coding evaluation",
    context: "256K",
    kvCache: "Auto (85%)",
    status: "staged",
    modalities: "Text",
    description: "Poolside 118B MoE coding and agentic model with 8.5B active parameters. A high-quality, primary-model-only option for long-horizon coding evaluation.",
    launchArgs: "--max-model-len 262144 --gpu-memory-utilization 0.85 --max-num-seqs 32",
    startupTimeoutSeconds: 1500,
    chatTemplate: false,
    enableToolChoice: false,
    extraVllmArgs: "--trust-remote-code --enable-auto-tool-choice --tool-call-parser poolside_v1 --reasoning-parser poolside_v1 --override-generation-config '{\"temperature\":0.7,\"top_p\":0.95}'",
  },
];

const MODEL_CATALOG_DEFINITION = await loadModelCatalogDefinition(BUILTIN_DGX_MODEL_CATALOG);
const DGX_MODEL_CATALOG = MODEL_CATALOG_DEFINITION.models;
const MODEL_DISCOVERY = MODEL_CATALOG_DEFINITION.discovery;

const DEFAULT_LATENCY_THRESHOLDS = {
  ttft: { good: 0.5, watch: 2 },
  queue: { good: 0.1, watch: 0.5 },
  e2e: { good: 5, watch: 20 },
  interToken: { good: 0.05, watch: 0.15 },
};

const MODEL_LATENCY_THRESHOLDS = {
  "redhat-qwen36-35b-nvfp4": DEFAULT_LATENCY_THRESHOLDS,
  "qwen38-27b-bf16": {
    ttft: { good: 1, watch: 3 },
    queue: { good: 0.15, watch: 0.75 },
    e2e: { good: 12, watch: 35 },
    interToken: { good: 0.1, watch: 0.25 },
  },
  "unsloth-qwen38-27b-nvfp4": {
    ttft: { good: 0.75, watch: 2.5 },
    queue: { good: 0.1, watch: 0.5 },
    e2e: { good: 8, watch: 25 },
    interToken: { good: 0.08, watch: 0.2 },
  },
  "nvidia-qwen36-27b-nvfp4": {
    ttft: { good: 0.75, watch: 2.5 },
    queue: { good: 0.1, watch: 0.5 },
    e2e: { good: 8, watch: 25 },
    interToken: { good: 0.08, watch: 0.2 },
  },
  "nvidia-gemma4-26b-a4b-nvfp4": {
    ttft: { good: 0.75, watch: 2.5 },
    queue: { good: 0.1, watch: 0.5 },
    e2e: { good: 8, watch: 25 },
    interToken: { good: 0.08, watch: 0.2 },
  },
  "nvidia-nemotron-3-nano-omni-30b-a3b-reasoning-nvfp4": {
    ttft: { good: 1, watch: 3 },
    queue: { good: 0.15, watch: 0.75 },
    e2e: { good: 10, watch: 30 },
    interToken: { good: 0.08, watch: 0.2 },
  },
  "nvidia-nemotron-35-lightning-30b-a3b-nvfp4": {
    ttft: { good: 0.75, watch: 2.5 },
    queue: { good: 0.1, watch: 0.5 },
    e2e: { good: 8, watch: 25 },
    interToken: { good: 0.06, watch: 0.18 },
  },
  "poolside-laguna-xs-21-nvfp4": {
    ttft: { good: 0.75, watch: 3 },
    queue: { good: 0.15, watch: 0.75 },
    e2e: { good: 10, watch: 30 },
    interToken: { good: 0.1, watch: 0.25 },
  },
  "poolside-laguna-s-21-nvfp4": {
    ttft: { good: 2, watch: 8 },
    queue: { good: 0.25, watch: 1.5 },
    e2e: { good: 20, watch: 60 },
    interToken: { good: 0.15, watch: 0.4 },
  },
};

let lastSnapshot = null;
let lastSparkDoctorRun = null;
let runInFlight = null;
let lastLiveVllm = null;
let history = await loadHistory();
let latencyHistory = await loadLatencyHistory();
const hfModelCache = new Map();
const activeLatencyBenchmarks = new Map();
let modelControlInFlight = null;
let lastModelControlAction = null;
let modelLoadProgress = null;
let lastSyntheticProbe = null;
let syntheticProbeInFlight = null;

function execCommand(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: options.timeout || 20000, maxBuffer: options.maxBuffer || 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        signal: error?.signal ?? null,
        stdout,
        stderr,
        message: error?.message ?? "",
      });
    });
  });
}

async function ssh(host, script, timeout = 20000) {
  return execCommand("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", host, "bash", "-lc", script], {
    timeout,
    maxBuffer: 1024 * 1024 * 12,
  });
}

async function runOnCompute(script, timeout = 20000) {
  if (CONFIG.compute.connection === "local") {
    return execCommand("bash", ["-lc", script], { timeout, maxBuffer: 1024 * 1024 * 12 });
  }
  return ssh(DGX_HOST, script, timeout);
}

async function resolveConfiguredVllmApiKey() {
  if (VLLM_API_KEY || !CONTROLLER_PATHS.apiKey) return VLLM_API_KEY;
  const encodedPath = Buffer.from(CONTROLLER_PATHS.apiKey, "utf8").toString("base64");
  const result = await runOnCompute(String.raw`
api_key_path=$(printf '%s' '${encodedPath}' | base64 -d)
test -r "$api_key_path" && cat "$api_key_path"
`, 7000);
  return result.ok ? result.stdout.trim() : "";
}

VLLM_API_KEY = await resolveConfiguredVllmApiKey();

async function collectSparkDoctorStatus() {
  if (!CONFIG.capabilities.sparkDoctorConfigured) {
    return {
      configured: false,
      available: false,
      directory: SPARK_DOCTOR_DIRECTORY,
      reason: "Spark Doctor is not enabled for this dashboard profile.",
      upstream: "https://github.com/joeynyc/spark-doctor",
    };
  }

  const encodedDirectory = Buffer.from(SPARK_DOCTOR_DIRECTORY, "utf8").toString("base64");
  const probe = String.raw`
directory=$(printf '%s' '${encodedDirectory}' | base64 -d)
executable="$directory/.venv/bin/spark-doctor"
available=false
reason=''
if [ ! -d "$directory" ]; then
  reason='Configured directory was not found.'
elif [ -x "$executable" ]; then
  available=true
elif command -v spark-doctor >/dev/null 2>&1; then
  executable=$(command -v spark-doctor)
  available=true
else
  reason='Spark Doctor executable was not found in the configured installation.'
fi
latest=$(ls -t "$HOME"/spark-doctor-runs/*/scan.json "$directory"/.spark-doctor/reports/*.json 2>/dev/null | head -1 || true)
python3 - "$directory" "$executable" "$available" "$reason" "$latest" <<'PY'
import json, pathlib, sys
directory, executable, available, reason, latest = sys.argv[1:]
latest_data = None
if latest:
    try:
        latest_data = json.loads(pathlib.Path(latest).read_text())
    except Exception:
        pass
print(json.dumps({
    "configured": True,
    "available": available == "true",
    "directory": directory,
    "executable": executable if available == "true" else "",
    "reason": reason,
    "upstream": "https://github.com/joeynyc/spark-doctor",
    "latest": {"path": latest, "data": latest_data},
}))
PY
`;
  const result = await runOnCompute(probe, 10000);
  if (!result.ok) {
    return {
      configured: true,
      available: false,
      directory: SPARK_DOCTOR_DIRECTORY,
      reason: result.stderr || result.message || "Unable to inspect the Spark Doctor installation.",
      upstream: "https://github.com/joeynyc/spark-doctor",
    };
  }
  return redactSensitiveData(safeJsonParse(result.stdout.trim().split("\n").at(-1), {
    configured: true,
    available: false,
    directory: SPARK_DOCTOR_DIRECTORY,
    reason: "Spark Doctor returned an unreadable installation status.",
    upstream: "https://github.com/joeynyc/spark-doctor",
  }));
}

function assertWriteAccess(req) {
  if (CONFIG.dashboard.mode === "readonly") {
    const error = new Error("This dashboard profile is read-only.");
    error.status = 403;
    throw error;
  }
  const expected = CONFIG.security.controlToken;
  if (!expected) return;
  const authorization = req.headers.authorization || "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : req.headers["x-dashboard-token"];
  if (supplied !== expected) {
    const error = new Error("A valid dashboard control token is required.");
    error.status = 401;
    throw error;
  }
}

function assertSettingsAccess(req) {
  const expected = CONFIG.security.controlToken;
  if (expected) {
    const authorization = req.headers.authorization || "";
    const supplied = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : req.headers["x-dashboard-token"];
    if (supplied !== expected) {
      const error = new Error("A valid dashboard control token is required.");
      error.status = 401;
      throw error;
    }
    return;
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(String(CONFIG.dashboard.host).toLowerCase());
  if (!loopback && !CONFIG.security.allowUnauthenticatedControl) {
    const error = new Error("Settings changes require a dashboard control token when the dashboard is available over the network.");
    error.status = 403;
    throw error;
  }
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parsePrometheusLabels(raw = "") {
  const labels = {};
  const matcher = /([A-Za-z_][A-Za-z0-9_]*)="((?:\\.|[^"])*)"/g;
  let match;
  while ((match = matcher.exec(raw))) {
    labels[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return labels;
}

function parsePrometheusSamples(raw = "") {
  const samples = [];
  const linePattern = /^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{([^}]*)\})?\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?:\s+\d+)?$/;
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const match = line.match(linePattern);
    if (!match) continue;
    const value = Number(match[3]);
    if (Number.isFinite(value)) samples.push({ name: match[1], labels: parsePrometheusLabels(match[2]), value });
  }
  return samples;
}

function metricSum(samples, name, predicate = () => true) {
  const matching = samples.filter((sample) => sample.name === name && predicate(sample.labels));
  return matching.length ? matching.reduce((total, sample) => total + sample.value, 0) : null;
}

function histogramQuantile(samples, metricName, quantile) {
  const buckets = new Map();
  for (const sample of samples) {
    if (sample.name !== `${metricName}_bucket`) continue;
    const upperBound = sample.labels.le;
    if (upperBound == null) continue;
    buckets.set(upperBound, (buckets.get(upperBound) || 0) + sample.value);
  }

  const total = buckets.get("+Inf");
  if (!Number.isFinite(total) || total <= 0) return null;
  const target = total * quantile;
  const finiteBuckets = [...buckets.entries()]
    .map(([upperBound, value]) => ({ upperBound: Number(upperBound), value }))
    .filter((bucket) => Number.isFinite(bucket.upperBound))
    .sort((a, b) => a.upperBound - b.upperBound);
  return finiteBuckets.find((bucket) => bucket.value >= target)?.upperBound ?? null;
}

function histogramPercentiles(samples, metricName) {
  return {
    p50Seconds: histogramQuantile(samples, metricName, 0.5),
    p95Seconds: histogramQuantile(samples, metricName, 0.95),
    p99Seconds: histogramQuantile(samples, metricName, 0.99),
  };
}

function histogramBands(samples, metricName, bands) {
  const buckets = new Map();
  for (const sample of samples) {
    if (sample.name !== `${metricName}_bucket`) continue;
    const upperBound = sample.labels.le;
    if (upperBound == null) continue;
    buckets.set(upperBound, (buckets.get(upperBound) || 0) + sample.value);
  }
  const total = buckets.get("+Inf");
  if (!Number.isFinite(total)) return [];

  const cumulativeAt = (upperBound) => {
    const exact = buckets.get(String(upperBound));
    if (Number.isFinite(exact)) return exact;
    const candidates = [...buckets.entries()]
      .map(([bound, value]) => ({ bound: Number(bound), value }))
      .filter((entry) => Number.isFinite(entry.bound) && entry.bound <= upperBound)
      .sort((a, b) => b.bound - a.bound);
    return candidates[0]?.value || 0;
  };

  let previous = 0;
  return bands.map(({ label, upperBound }) => {
    const cumulative = upperBound === Infinity ? total : cumulativeAt(upperBound);
    const count = Math.max(0, cumulative - previous);
    previous = cumulative;
    return { label, count };
  });
}

function buildVllmMetrics(raw) {
  const samples = parsePrometheusSamples(raw);
  if (!samples.length) return { available: false };

  const promptTokens = metricSum(samples, "vllm:prompt_tokens_total");
  const generationTokens = metricSum(samples, "vllm:generation_tokens_total");
  const requestTotal = metricSum(samples, "vllm:request_success_total") || 0;
  const requestErrors = metricSum(samples, "vllm:request_success_total", (labels) => labels.finished_reason === "error") || 0;
  const requestAborts = metricSum(samples, "vllm:request_success_total", (labels) => labels.finished_reason === "abort") || 0;
  const prefixQueries = metricSum(samples, "vllm:prefix_cache_queries_total") || 0;
  const prefixHits = metricSum(samples, "vllm:prefix_cache_hits_total") || 0;
  const kvCacheUsage = metricSum(samples, "vllm:kv_cache_usage_perc");
  const draftTokens = metricSum(samples, "vllm:spec_decode_num_draft_tokens_total") || 0;
  const acceptedTokens = metricSum(samples, "vllm:spec_decode_num_accepted_tokens_total") || 0;
  const acceptedByPosition = samples
    .filter((sample) => sample.name === "vllm:spec_decode_num_accepted_tokens_per_pos_total")
    .reduce((positions, sample) => {
      const position = Number(sample.labels.position);
      if (!Number.isFinite(position)) return positions;
      positions.set(position, (positions.get(position) || 0) + sample.value);
      return positions;
    }, new Map());
  const speculativeByPosition = [...acceptedByPosition.entries()]
    .sort(([left], [right]) => left - right)
    .map(([position, accepted], index, all) => {
      const eligible = index === 0 ? draftTokens : all[index - 1][1];
      return {
        position,
        accepted,
        eligible,
        acceptanceRatePct: eligible > 0 ? (accepted / eligible) * 100 : null,
      };
    });
  const latencyPercentiles = {
    ttft: histogramPercentiles(samples, "vllm:time_to_first_token_seconds"),
    interToken: histogramPercentiles(samples, "vllm:inter_token_latency_seconds"),
    e2e: histogramPercentiles(samples, "vllm:e2e_request_latency_seconds"),
    queue: histogramPercentiles(samples, "vllm:request_queue_time_seconds"),
  };

  return {
    available: true,
    promptTokens,
    generationTokens,
    totalTokens: (promptTokens || 0) + (generationTokens || 0),
    requests: {
      total: requestTotal,
      errors: requestErrors,
      aborted: requestAborts,
      successful: Math.max(0, requestTotal - requestErrors - requestAborts),
    },
    queue: {
      running: metricSum(samples, "vllm:num_requests_running") || 0,
      waiting: metricSum(samples, "vllm:num_requests_waiting") || 0,
    },
    cache: {
      kvUsagePct: Number.isFinite(kvCacheUsage) ? kvCacheUsage * 100 : null,
      prefixHitRatePct: prefixQueries > 0 ? (prefixHits / prefixQueries) * 100 : null,
      prefixQueries,
      prefixHits,
    },
    toolCalls: metricSum(samples, "vllm:tool_call_parser_invocations_total") || 0,
    speculative: {
      draftTokens,
      acceptedTokens,
      rejectedTokens: Math.max(0, draftTokens - acceptedTokens),
      acceptanceRatePct: draftTokens > 0 ? (acceptedTokens / draftTokens) * 100 : null,
      byPosition: speculativeByPosition,
    },
    requestSize: {
      prompt: histogramBands(samples, "vllm:request_prompt_tokens", [
        { label: "≤50", upperBound: 50 },
        { label: "51–200", upperBound: 200 },
        { label: "201–1K", upperBound: 1000 },
        { label: "1K–5K", upperBound: 5000 },
        { label: "5K–20K", upperBound: 20000 },
        { label: ">20K", upperBound: Infinity },
      ]),
      output: histogramBands(samples, "vllm:request_generation_tokens", [
        { label: "≤20", upperBound: 20 },
        { label: "21–100", upperBound: 100 },
        { label: "101–500", upperBound: 500 },
        { label: "501–1K", upperBound: 1000 },
        { label: "1K–5K", upperBound: 5000 },
        { label: ">5K", upperBound: Infinity },
      ]),
    },
    latency: {
      ...latencyPercentiles,
      ttftP95Seconds: latencyPercentiles.ttft.p95Seconds,
      interTokenP95Seconds: latencyPercentiles.interToken.p95Seconds,
      e2eP95Seconds: latencyPercentiles.e2e.p95Seconds,
      queueP95Seconds: latencyPercentiles.queue.p95Seconds,
    },
  };
}

function counterRate(current, previous, elapsedSeconds) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || current < previous) return null;
  return (current - previous) / elapsedSeconds;
}

function identifyServedModel(models = []) {
  const canonicalNames = new Map(DGX_MODEL_CATALOG.map((model) => [model.servedNames.at(-1), model]));
  const served = models.find((model) => canonicalNames.has(model.id))
    || models.find((model) => model.id !== "qwen3-14b")
    || models[0]
    || null;
  const configured = served
    ? canonicalNames.get(served.id)
      || DGX_MODEL_CATALOG.find((model) => String(served.root || "").includes(model.cacheDirectory))
    : null;
  return {
    key: configured?.key || null,
    id: served?.id || null,
    label: configured?.label || served?.id || null,
    repository: configured?.repository || inferHuggingFaceRepo(served || {}) || null,
  };
}

async function runSyntheticCompletionProbe() {
  if (syntheticProbeInFlight) return syntheticProbeInFlight;
  syntheticProbeInFlight = (async () => {
    const startedAt = performance.now();
    const collectedAt = new Date().toISOString();
    try {
      const response = await fetch(`${VLLM_API_URL}/chat/completions`, {
        method: "POST",
        headers: vllmHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          model: "qwen3-14b",
          messages: [{ role: "user", content: "Reply with exactly OK." }],
          temperature: 0,
          max_tokens: 32,
        }),
        signal: AbortSignal.timeout(120000),
      });
      const payload = await response.json().catch(() => null);
      const content = payload?.choices?.[0]?.message?.content;
      lastSyntheticProbe = {
        ok: response.ok && typeof content === "string" && content.trim().length > 0,
        status: response.status,
        latencyMs: performance.now() - startedAt,
        collectedAt,
        model: payload?.model || "qwen3-14b",
        error: response.ok ? null : payload?.error?.message || `HTTP ${response.status}`,
      };
    } catch (error) {
      lastSyntheticProbe = {
        ok: false,
        status: null,
        latencyMs: performance.now() - startedAt,
        collectedAt,
        model: "qwen3-14b",
        error: error.name === "TimeoutError" ? "Timed out after 120 seconds" : error.message,
      };
    } finally {
      syntheticProbeInFlight = null;
    }
    return lastSyntheticProbe;
  })();
  return syntheticProbeInFlight;
}

function maybeRunSyntheticCompletionProbe() {
  if (!CONFIG.capabilities.benchmarks) return;
  const lastRun = lastSyntheticProbe?.collectedAt ? new Date(lastSyntheticProbe.collectedAt).getTime() : 0;
  if (!syntheticProbeInFlight && Date.now() - lastRun >= SYNTHETIC_PROBE_INTERVAL_MS) {
    runSyntheticCompletionProbe().catch((error) => console.error("Synthetic completion probe failed", error));
  }
}

async function collectLiveVllmMetrics() {
  const now = Date.now();
  if (lastLiveVllm && now - lastLiveVllm.collectedAtMs < VLLM_LIVE_POLL_INTERVAL_MS) return lastLiveVllm.response;

  const gpuPromise = collectLiveGpuMetrics();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const metricsStartedAt = performance.now();
    const response = await fetch(VLLM_METRICS_URL, { signal: controller.signal });
    const metricsLatencyMs = performance.now() - metricsStartedAt;
    if (!response.ok) throw new Error(`vLLM metrics returned ${response.status}`);
    const metrics = buildVllmMetrics(await response.text());
    if (!metrics.available) throw new Error("vLLM metrics response did not include Prometheus samples");

    let modelsProbe = { ok: false, status: null, latencyMs: null };
    try {
      const modelsStartedAt = performance.now();
      const modelsResponse = await fetch(`${VLLM_API_URL}/models`, {
        headers: vllmHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      const modelsPayload = await modelsResponse.json().catch(() => ({ data: [] }));
      const servedModels = Array.isArray(modelsPayload?.data) ? modelsPayload.data : [];
      modelsProbe = {
        ok: modelsResponse.ok,
        status: modelsResponse.status,
        latencyMs: performance.now() - modelsStartedAt,
        model: identifyServedModel(servedModels),
      };
    } catch (error) {
      modelsProbe.error = error.name === "TimeoutError" ? "Timed out" : error.message;
    }
    maybeRunSyntheticCompletionProbe();
    metrics.endpoints = {
      metrics: { ok: true, status: response.status, latencyMs: metricsLatencyMs },
      models: modelsProbe,
      chatCompletions: {
        ok: modelsProbe.ok && metrics.requests?.errors === 0,
        observedRequests: metrics.requests?.total || 0,
        errors: metrics.requests?.errors || 0,
        p95LatencySeconds: metrics.latency?.e2e?.p95Seconds ?? null,
      },
      syntheticCompletion: lastSyntheticProbe,
      gatewayToVllmLatencyMs: modelsProbe.latencyMs,
    };

    const previous = lastLiveVllm;
    const elapsedSeconds = previous ? (now - previous.collectedAtMs) / 1000 : null;
    metrics.rates = {
      promptTokensPerSecond: counterRate(metrics.promptTokens, previous?.response.metrics?.promptTokens, elapsedSeconds),
      generationTokensPerSecond: counterRate(metrics.generationTokens, previous?.response.metrics?.generationTokens, elapsedSeconds),
      totalTokensPerSecond: counterRate(metrics.totalTokens, previous?.response.metrics?.totalTokens, elapsedSeconds),
      requestsPerSecond: counterRate(metrics.requests?.total, previous?.response.metrics?.requests?.total, elapsedSeconds),
    };

    const gpu = await gpuPromise;
    const result = { ok: true, collectedAt: new Date(now).toISOString(), metrics, gpu };
    lastLiveVllm = { collectedAtMs: now, response: result };
    return result;
  } catch (error) {
    return {
      ok: false,
      collectedAt: new Date(now).toISOString(),
      error: error.name === "AbortError" ? "vLLM metrics request timed out" : error.message,
      gpu: await gpuPromise,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function collectLiveGpuMetrics() {
  if (!CONFIG.capabilities.nvidiaTelemetry) return [];
  const command = "nvidia-smi --query-gpu=name,driver_version,utilization.gpu,power.draw,clocks.current.graphics,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null || true";
  const result = CONFIG.compute.connection === "local"
    ? await execCommand("bash", ["-lc", command], { timeout: 4000, maxBuffer: 1024 * 1024 })
    : await execCommand("ssh", [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=6",
      DGX_HOST,
      command,
    ], { timeout: 4000, maxBuffer: 1024 * 1024 });
  if (!result.ok) return [];
  return result.stdout.trim().split("\n").filter(Boolean).map(csvLineToGpu);
}

async function fetchVllmModels() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${VLLM_API_URL}/models`, {
      headers: vllmHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`vLLM models returned ${response.status}`);
    const payload = await response.json();
    const models = Array.isArray(payload?.data) ? payload.data : [];
    const modelsWithPresentation = models.map((model) => {
      const root = typeof model.root === "string" ? model.root : "";
      const repository = inferHuggingFaceRepo(model);
      const configuredModel = DGX_MODEL_CATALOG.find((candidate) => (
        root.includes(candidate.cacheDirectory) || repository === candidate.repository
      ));
      const applicationAlias = configuredModel?.servedNames?.[0] || null;
      const isApplicationAlias = Boolean(applicationAlias && model.id === applicationAlias);
      const modalities = configuredModel?.modalities || "Text";

      return {
        id: model.id,
        root: model.root,
        maxModelLen: model.max_model_len,
        configuredModelKey: configuredModel?.key || null,
        configuredModelName: configuredModel?.label || null,
        applicationAlias,
        isApplicationAlias,
        selectable: !isApplicationAlias,
        modalities,
        visualCapable: /\b(?:image|video)\b/i.test(modalities),
        label: isApplicationAlias
          ? `Application alias: ${model.id}`
          : configuredModel
            ? `${configuredModel.label} (${model.id})`
            : model.id,
      };
    });

    const catalogModels = buildCatalogModels(DGX_MODEL_CATALOG, modelsWithPresentation);

    return {
      ok: true,
      endpoint: VLLM_API_URL,
      models: modelsWithPresentation,
      selectableModels: modelsWithPresentation.filter((model) => model.selectable),
      applicationAliases: modelsWithPresentation.filter((model) => model.isApplicationAlias),
      catalogModels,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: VLLM_API_URL,
      error: error.name === "AbortError" ? "vLLM model discovery timed out" : error.message,
      models: [],
      selectableModels: [],
      applicationAliases: [],
      catalogModels: buildCatalogModels(DGX_MODEL_CATALOG),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getDgxModel(modelKey) {
  return DGX_MODEL_CATALOG.find((model) => model.key === modelKey) || null;
}

function createVllmLaunchScript(model) {
  if (model.runtime === "docker") return createDockerVllmLaunchScript(model);
  const quantization = model.quantization ? ` --quantization ${model.quantization}` : "";
  const speculativeConfig = model.speculativeConfig ? ` --speculative-config '${model.speculativeConfig}'` : "";
  const runtime = model.legacyRuntime ? CONTROLLER_PATHS.legacyRuntime : CONTROLLER_PATHS.nativeRuntime;
  const contextAndCache = model.launchArgs || (model.legacyRuntime
    ? "--max-model-len 32768 --gpu-memory-utilization 0.65"
    : "--max-model-len 131072 --kv-cache-memory-bytes 8G");
  const chatTemplate = model.chatTemplate === false ? "" : ` --chat-template ${CONTROLLER_PATHS.chatTemplate}`;
  const toolCalling = model.enableToolChoice === false ? "" : " --enable-auto-tool-choice --tool-call-parser qwen3_xml";
  const extraVllmArgs = model.extraVllmArgs ? ` ${computePath(model.extraVllmArgs)}` : "";
  const ffmpeg = CONTROLLER_PATHS.ffmpegLibraries;

  return `#!/usr/bin/env bash
set -euo pipefail
export CUTE_DSL_ARCH=sm_121a
export MAX_JOBS=4
export FLASHINFER_NVCC_THREADS=1
export LD_LIBRARY_PATH=${ffmpeg}:${ffmpeg}/blas:${ffmpeg}/lapack${"${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"}
source ${model.legacyRuntime ? CONTROLLER_PATHS.legacyActivate : CONTROLLER_PATHS.nativeActivate}
mkdir -p ${CONTROLLER_PATHS.media}
chmod 750 ${CONTROLLER_PATHS.media}
VLLM_AUTH_ARGS=()
if [ -s ${CONTROLLER_PATHS.apiKey} ]; then
  VLLM_AUTH_ARGS=(--api-key "$(cat ${CONTROLLER_PATHS.apiKey})")
fi
MODEL_PATH=$(find ${CONTROLLER_PATHS.cache}/${model.cacheDirectory}/snapshots -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)
if [ -z "$MODEL_PATH" ]; then
  echo "Model snapshot is not available for ${model.repository}" >&2
  exit 1
fi
exec ${runtime} serve "$MODEL_PATH" --served-model-name ${model.servedNames.join(" ")} --host 0.0.0.0 --port ${MODEL_CONTROLLER_PORT} "${"${VLLM_AUTH_ARGS[@]}"}" ${contextAndCache}${quantization}${chatTemplate}${toolCalling}${speculativeConfig}${extraVllmArgs}
`;
}

function createDockerVllmLaunchScript(model) {
  const modelArgs = model.dockerArgs ? ` ${model.dockerArgs}` : "";
  const maxNumSeqs = model.maxNumSeqs ? ` --max-num-seqs ${model.maxNumSeqs}` : "";
  const maxModelLen = model.maxModelLen || 131072;
  const maxBatchedTokens = model.maxBatchedTokens ? ` --max-num-batched-tokens ${model.maxBatchedTokens}` : "";
  return `#!/usr/bin/env bash
set -euo pipefail
mkdir -p ${CONTROLLER_PATHS.media}
chmod 750 ${CONTROLLER_PATHS.media}
VLLM_AUTH_ARGS=()
if [ -s ${CONTROLLER_PATHS.apiKey} ]; then
  VLLM_AUTH_ARGS=(--api-key "$(cat ${CONTROLLER_PATHS.apiKey})")
fi
docker rm -f ${MODEL_CONTAINER_NAME} >/dev/null 2>&1 || true
exec docker run --rm --name ${MODEL_CONTAINER_NAME} --gpus all --network host --ipc=host \\
  -v ${CONTROLLER_HOME}/.cache/huggingface:/root/.cache/huggingface \\
  -v ${CONTROLLER_HOME}/.cache/vllm:/root/.cache/vllm \\
  -v ${CONTROLLER_PATHS.media}:/media:ro \\
  ${model.dockerImage} ${model.repository} \\
  --served-model-name ${model.servedNames.join(" ")} \\
  --host 0.0.0.0 --port ${MODEL_CONTROLLER_PORT} \\
  --max-model-len ${maxModelLen} --kv-cache-memory-bytes 8G${maxBatchedTokens}${maxNumSeqs} \\
  --allowed-local-media-path /media${modelArgs} \\
  "${"${VLLM_AUTH_ARGS[@]}"}"
`;
}

function estimateModelLoadProgress(telemetry, endpointReady) {
  if (!modelLoadProgress) return null;

  const now = Date.now();
  const memoryUsedGb = Number(telemetry?.memoryUsedGb);
  if (Number.isFinite(memoryUsedGb)) {
    modelLoadProgress.memoryUsedGb = memoryUsedGb;
    modelLoadProgress.minimumMemoryUsedGb = Math.min(
      modelLoadProgress.minimumMemoryUsedGb ?? memoryUsedGb,
      memoryUsedGb,
    );
    modelLoadProgress.loadedMemoryGb = Math.max(0, memoryUsedGb - modelLoadProgress.minimumMemoryUsedGb);
  }

  const rawLogStreams = typeof telemetry?.logs === "string"
    ? [telemetry.logs]
    : Object.values(telemetry?.logs || {}).filter((value) => typeof value === "string");
  const logs = rawLogStreams.map((rawLog) => {
    const markerIndex = rawLog.lastIndexOf(modelLoadProgress.marker);
    return markerIndex >= 0 ? rawLog.slice(markerIndex) : "";
  }).join("\n")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  let percent = 7;
  let phase = "Preparing runtime";
  let detail = "Stopping the prior model and starting the vLLM runtime.";

  const shardMatches = [...logs.matchAll(/Loading safetensors checkpoint shards:\s*(\d{1,3})%/gi)];
  if (shardMatches.length) {
    const shardPercent = Math.min(100, Number(shardMatches.at(-1)[1]));
    percent = 12 + shardPercent * 0.48;
    phase = "Loading checkpoint";
    detail = `Loading model weight shards (${shardPercent}%).`;
  }
  if (/loading model weights took|model weights.*loaded|weights loading took/i.test(logs)) {
    percent = 64;
    phase = "Initializing model";
    detail = "Model weights are loaded; vLLM is initializing the execution engine.";
  }
  if (/torch\.compile|compil(?:e|ing|ation)|dynamo/i.test(logs)) {
    percent = 75;
    phase = "Compiling kernels";
    detail = "Compiling and caching optimized execution kernels.";
  }
  if (/captur(?:e|ing).*cuda graph|cuda graph.*captur/i.test(logs)) {
    percent = 86;
    phase = "Warming execution";
    detail = "Capturing CUDA graphs and warming the model runtime.";
  }
  if (/application startup complete|starting vllm api server|available routes/i.test(logs)) {
    percent = 94;
    phase = "Starting API";
    detail = "The model engine is loaded and the API endpoint is starting.";
  }
  if (endpointReady) {
    percent = 97;
    phase = "Verifying model";
    detail = "The endpoint is online; running its compatibility smoke test.";
  }

  modelLoadProgress.percent = Math.max(modelLoadProgress.percent || 0, Math.round(percent));
  modelLoadProgress.phase = phase;
  modelLoadProgress.detail = detail;
  modelLoadProgress.elapsedSeconds = Math.max(0, Math.round((now - Date.parse(modelLoadProgress.startedAt)) / 1000));
  modelLoadProgress.updatedAt = new Date(now).toISOString();

  return {
    modelKey: modelLoadProgress.modelKey,
    phase: modelLoadProgress.phase,
    detail: modelLoadProgress.detail,
    percent: Math.min(99, modelLoadProgress.percent),
    elapsedSeconds: modelLoadProgress.elapsedSeconds,
    memoryUsedGb: modelLoadProgress.memoryUsedGb ?? null,
    loadedMemoryGb: modelLoadProgress.loadedMemoryGb ?? null,
    startedAt: modelLoadProgress.startedAt,
    updatedAt: modelLoadProgress.updatedAt,
  };
}

async function collectDgxModelControl() {
  const modelInstallTargets = DGX_MODEL_CATALOG.map(({ key, cacheDirectory, readyMarker }) => ({
    key,
    cacheDirectory,
    readyMarker: readyMarker ? computePath(readyMarker) : null,
  }));
  const encodedInstallProbe = Buffer.from(JSON.stringify({
    root: CONTROLLER_PATHS.cache,
    targets: modelInstallTargets,
  }), "utf8").toString("base64");
  const remote = String.raw`
export PATH="${CONTROLLER_HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
echo __PM2__
pm2 jlist 2>/dev/null || echo '[]'
echo __INSTALLED__
python3 - <<'PY'
import base64
import json
from pathlib import Path

# Decode structured data instead of embedding JSON as Python source. JSON null
# is not a valid Python literal and previously caused every probe to fail.
probe = json.loads(base64.b64decode('${encodedInstallProbe}').decode('utf-8'))
root = Path(probe['root'])
states = {}
for target in probe['targets']:
    downloaded = any((root / target['cacheDirectory'] / 'snapshots').glob('*'))
    marker = target.get('readyMarker')
    verified = downloaded and (not marker or Path(marker).is_file())
    states[target['key']] = {
        'downloaded': downloaded,
        'verified': verified,
    }
discovered = []
if root.is_dir():
    for directory in root.glob('models--*'):
        if directory.is_dir() and any((directory / 'snapshots').glob('*')):
            discovered.append(directory.name)
print(json.dumps({'states': states, 'cacheDirectories': sorted(discovered)}))
PY
echo __VLLM__
VLLM_PROBE_HOST="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
if [ -n "$VLLM_PROBE_HOST" ]; then
  export VLLM_PROBE_BASE="http://$VLLM_PROBE_HOST:${MODEL_CONTROLLER_PORT}"
else
  export VLLM_PROBE_BASE="http://127.0.0.1:${MODEL_CONTROLLER_PORT}"
fi
python3 - <<'PY' 2>/dev/null || true
import os
import urllib.request
from pathlib import Path
try:
    key_path = Path('${CONTROLLER_PATHS.apiKey}')
    headers = {'Authorization': 'Bearer ' + key_path.read_text().strip()} if key_path.is_file() else {}
    request = urllib.request.Request(os.environ['VLLM_PROBE_BASE'] + '/v1/models', headers=headers)
    with urllib.request.urlopen(request, timeout=3) as response:
        print(response.read().decode())
except Exception:
    pass
PY
echo __LOAD__
python3 - <<'PY'
import json
from pathlib import Path

values = {}
for line in Path('/proc/meminfo').read_text().splitlines():
    key, raw = line.split(':', 1)
    values[key] = int(raw.strip().split()[0]) * 1024
total = values.get('MemTotal', 0)
available = values.get('MemAvailable', 0)
logs = {}
for path in (
    Path('${MODEL_OUT_LOG}'),
    Path('${MODEL_ERROR_LOG}'),
):
    if path.is_file():
        with path.open('rb') as handle:
            handle.seek(max(0, path.stat().st_size - 131072))
            logs[path.name] = handle.read().decode('utf-8', errors='replace')
print(json.dumps({
    'memoryUsedGb': round((total - available) / (1024 ** 3), 2),
    'memoryAvailableGb': round(available / (1024 ** 3), 2),
    'logs': logs,
}))
PY
echo __SCRIPT__
cat ${MODEL_LAUNCH_SCRIPT} 2>/dev/null || true
`;
  const result = await runOnCompute(remote, 16000);
  if (!result.ok) return { ok: false, collectedAt: new Date().toISOString(), error: result.stderr || result.message, models: [] };

  const [, afterPm2 = ""] = result.stdout.split("__PM2__\n");
  const [pm2Raw = "", afterInstalled = ""] = afterPm2.split("__INSTALLED__\n");
  const [installedRaw = "", afterVllm = ""] = afterInstalled.split("__VLLM__\n");
  const [vllmRaw = "", afterLoad = ""] = afterVllm.split("__LOAD__\n");
  const [loadRaw = "", scriptRaw = ""] = afterLoad.split("__SCRIPT__\n");
  const pm2List = safeJsonParse(pm2Raw.trim(), []);
  const process = Array.isArray(pm2List) ? pm2List.find((item) => item.name === MODEL_SERVICE_NAME) : null;
  const installProbe = safeJsonParse(installedRaw.trim(), {});
  const installed = installProbe?.states || installProbe;
  const vllmPayload = safeJsonParse(vllmRaw.trim(), { data: [] });
  const servedModels = Array.isArray(vllmPayload?.data) ? vllmPayload.data : [];
  const loadTelemetry = safeJsonParse(loadRaw.trim(), {});
  const selectedModel = DGX_MODEL_CATALOG.find((model) => scriptRaw.includes(model.cacheDirectory)
    || scriptRaw.includes(model.repository)
    || servedModels.some((served) => String(served.root || "").includes(model.cacheDirectory))) || null;
  const pm2Status = process?.pm2_env?.status || "unknown";
  const endpointReady = servedModels.length > 0;
  const active = endpointReady ? selectedModel : null;
  const progressModel = modelLoadProgress ? getDgxModel(modelLoadProgress.modelKey) : null;
  const progressEndpointReady = Boolean(progressModel?.servedNames.some((expectedName) => (
    servedModels.some((servedModel) => servedModel.id === expectedName)
  )));
  const loadProgress = estimateModelLoadProgress(loadTelemetry, progressEndpointReady);
  const loadingModelKey = loadProgress?.modelKey
    || (!endpointReady && pm2Status === "online" ? selectedModel?.key || null : null);

  return {
    ok: true,
    collectedAt: new Date().toISOString(),
    service: {
      pm2Status,
      endpointReady,
      state: loadProgress ? "starting" : endpointReady ? "ready" : pm2Status === "online" ? "starting" : pm2Status,
      restarts: Number(process?.pm2_env?.restart_time || 0),
      uptimeSince: process?.pm2_env?.pm_uptime || null,
      servedNames: servedModels.map((model) => model.id).filter(Boolean),
      memoryUsedGb: Number.isFinite(loadTelemetry.memoryUsedGb) ? loadTelemetry.memoryUsedGb : null,
      memoryAvailableGb: Number.isFinite(loadTelemetry.memoryAvailableGb) ? loadTelemetry.memoryAvailableGb : null,
    },
    activeModelKey: active?.key || null,
    loadingModelKey,
    loadProgress,
    models: DGX_MODEL_CATALOG.map((model) => {
      const installState = installed?.[model.key];
      const downloaded = typeof installState === "object"
        ? Boolean(installState?.downloaded)
        : Boolean(installState);
      const verified = typeof installState === "object"
        ? Boolean(installState?.verified)
        : Boolean(installState);

      return {
        key: model.key,
        label: model.label,
        provider: model.provider,
        providerLogo: model.providerLogo || null,
        repository: model.repository,
        precision: model.precision,
        parameters: model.parameters,
        architecture: model.architecture,
        checkpointSize: model.checkpointSize,
        bestFor: model.bestFor,
        context: model.context,
        kvCache: model.kvCache,
        status: verified ? "ready" : downloaded ? "staged" : "unavailable",
        description: model.description,
        installed: downloaded,
        verified,
        active: active?.key === model.key,
        loading: loadingModelKey === model.key,
        loadProgress: loadingModelKey === model.key ? loadProgress : null,
        servedNames: model.servedNames,
        modalities: model.modalities || "Text",
      };
    }).concat(MODEL_DISCOVERY.enabled && MODEL_DISCOVERY.includeUnknown
      ? buildDiscoveredModels(installProbe?.cacheDirectories, DGX_MODEL_CATALOG)
      : []),
    lastAction: lastModelControlAction,
  };
}

async function runDgxModelControl(input) {
  if (modelControlInFlight) throw new Error("A model control action is already in progress.");
  const action = typeof input?.action === "string" ? input.action : "";
  const allowedActions = new Set(["start", "stop", "restart", "activate"]);
  if (!allowedActions.has(action)) throw new Error("Unsupported model control action.");
  const model = action === "activate" ? getDgxModel(input?.modelKey) : null;
  if (action === "activate" && !model) throw new Error("Select a model from the dashboard catalog.");

  const currentState = await collectDgxModelControl();
  if (!currentState.ok) throw new Error(currentState.error || "Unable to inspect the Spark model service.");
  if (action === "activate") {
    const selected = currentState.models.find((item) => item.key === model.key);
    if (!selected?.installed) throw new Error(`${model.repository} is not downloaded on the Spark.`);
  }

  const encodedScript = model ? Buffer.from(createVllmLaunchScript(model), "utf8").toString("base64") : "";
  const expectedModelName = model?.servedNames.at(-1) || "";
  const loadMarker = action === "activate" ? `MODEL_LOAD_START_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : "";
  const startupTimeoutSeconds = model?.startupTimeoutSeconds || 600;
  const startupAttempts = Math.ceil(startupTimeoutSeconds / 5);
  const readinessProbe = model?.readinessProbe || "tool";
  const smokePayload = readinessProbe === "text"
    ? {
        model: "qwen3-14b",
        messages: [{ role: "user", content: "Reply with exactly READY." }],
        temperature: 0,
        max_tokens: 32,
      }
    : {
        model: "qwen3-14b",
        messages: [{ role: "user", content: "Call the ping function with value ready." }],
        tools: [{
          type: "function",
          function: {
            name: "ping",
            description: "Returns a supplied value.",
            parameters: {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "ping" } },
        max_tokens: 256,
      };
  const encodedSmokePayload = Buffer.from(JSON.stringify(smokePayload), "utf8").toString("base64");
  const smokeValidation = readinessProbe === "text"
    ? "printf '%s' \"$smoke\" | python3 -c 'import json, sys; payload = json.load(sys.stdin); content = payload.get(\"choices\", [{}])[0].get(\"message\", {}).get(\"content\"); raise SystemExit(0 if isinstance(content, str) and content.strip() else 1)'"
    : "printf '%s' \"$smoke\" | python3 -c 'import json, sys; payload = json.load(sys.stdin); calls = payload.get(\"choices\", [{}])[0].get(\"message\", {}).get(\"tool_calls\"); raise SystemExit(0 if calls else 1)'";
  const probeLabel = readinessProbe === "text" ? "text-generation" : "tool-calling";
  // A responsive /v1/models endpoint only proves that vLLM has started. The
  // selected model must also complete its supported compatibility probe before
  // it can replace the primary service.
  const readinessCheck = [
    "failure_reason='Candidate did not expose the expected model endpoint.'",
    `auth_header=(); if [ -s ${CONTROLLER_PATHS.apiKey} ]; then auth_header=(-H \"Authorization: Bearer $(cat ${CONTROLLER_PATHS.apiKey})\"); fi`,
    `initial_restarts=$(pm2 jlist | python3 -c 'import json, sys; processes = json.load(sys.stdin); print(next((item.get(\"pm2_env\", {}).get(\"restart_time\", 0) for item in processes if item.get(\"name\") == \"${MODEL_SERVICE_NAME}\"), 0))')`,
    `expected_model=${JSON.stringify(expectedModelName)}`,
    `for attempt in $(seq 1 ${startupAttempts}); do`,
    `  models=$(curl -fsS --max-time 4 "${"${auth_header[@]}"}" http://127.0.0.1:${MODEL_CONTROLLER_PORT}/v1/models 2>/dev/null || true)`,
    "  if printf '%s' \"$models\" | grep -Fq \"\\\"id\\\":\\\"$expected_model\\\"\"; then ready=1; failure_reason=''; break; fi",
    `  current_restarts=$(pm2 jlist | python3 -c 'import json, sys; processes = json.load(sys.stdin); print(next((item.get(\"pm2_env\", {}).get(\"restart_time\", 0) for item in processes if item.get(\"name\") == \"${MODEL_SERVICE_NAME}\"), 0))')`,
    "  if [ \"$current_restarts\" -gt \"$initial_restarts\" ]; then failure_reason='Candidate vLLM process exited during startup.'; break; fi",
    "  sleep 5",
    "done",
    "if [ \"${ready:-0}\" -eq 1 ]; then",
    `  smoke=$(printf '%s' '${encodedSmokePayload}' | base64 -d | curl -fsS --max-time 90 "${"${auth_header[@]}"}" http://127.0.0.1:${MODEL_CONTROLLER_PORT}/v1/chat/completions -H 'Content-Type: application/json' --data-binary @- || true)`,
    `  ${smokeValidation} || { ready=0; failure_reason='Candidate endpoint started but failed the ${probeLabel} readiness probe.'; }`,
    "fi",
  ].join("\n");
  // PM2 can automatically restart a failed candidate while rollback is trying
  // to restore the prior launch script. Stop the process and remove only its
  // named container on both sides of a replacement to avoid that race.
  const stopPrimary = `pm2 stop ${MODEL_SERVICE_NAME} || true; docker rm -f ${MODEL_CONTAINER_NAME} >/dev/null 2>&1 || true`;
  const command = action === "stop"
    ? `pm2 stop ${MODEL_SERVICE_NAME} || true; pm2 save`
    : action === "activate"
      ? `cp ${MODEL_LAUNCH_SCRIPT} ${MODEL_BACKUP_SCRIPT}; ${stopPrimary}; printf '\n%s\n' '${loadMarker}' >> ${MODEL_OUT_LOG}; printf '\n%s\n' '${loadMarker}' >> ${MODEL_ERROR_LOG}; printf '%s' '${encodedScript}' | base64 -d > ${MODEL_LAUNCH_SCRIPT}; chmod 700 ${MODEL_LAUNCH_SCRIPT}; pm2 start ${MODEL_SERVICE_NAME} --update-env; ready=0; ${readinessCheck}; if [ "$ready" -ne 1 ]; then ${stopPrimary}; cp ${MODEL_BACKUP_SCRIPT} ${MODEL_LAUNCH_SCRIPT}; chmod 700 ${MODEL_LAUNCH_SCRIPT}; pm2 start ${MODEL_SERVICE_NAME} --update-env; pm2 save; echo "$failure_reason The prior primary launch script was restored." >&2; exit 1; fi; pm2 save`
      : `pm2 ${action} ${MODEL_SERVICE_NAME} --update-env; pm2 save`;
  const remote = `export PATH="${CONTROLLER_HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; set -e; ${command}; pm2 jlist`;
  const label = action === "activate" ? `Switched to ${model.label} (${model.provider})` : `${action[0].toUpperCase()}${action.slice(1)} requested`;
  const controlTimeout = action === "activate" ? (startupTimeoutSeconds + 120) * 1000 : 30000;

  if (action === "activate") {
    const initialMemoryUsedGb = Number(currentState.service?.memoryUsedGb);
    modelLoadProgress = {
      modelKey: model.key,
      marker: loadMarker,
      phase: "Preparing runtime",
      detail: "Stopping the prior model and starting the vLLM runtime.",
      percent: 3,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      memoryUsedGb: Number.isFinite(initialMemoryUsedGb) ? initialMemoryUsedGb : null,
      minimumMemoryUsedGb: Number.isFinite(initialMemoryUsedGb) ? initialMemoryUsedGb : null,
      loadedMemoryGb: 0,
    };
  }

  modelControlInFlight = runOnCompute(remote, controlTimeout).then(async (result) => {
    if (!result.ok) throw new Error(result.stderr || result.message || "The model service action failed.");
    if (action !== "stop") await runAgentGatewayCompatibilityProbe();
    lastModelControlAction = { ok: true, label, action, modelKey: model?.key || currentState.activeModelKey, at: new Date().toISOString() };
    lastLiveVllm = null;
    lastSyntheticProbe = null;
    if (action !== "stop") setTimeout(maybeRunSyntheticCompletionProbe, 2000).unref();
    return lastModelControlAction;
  }).catch((error) => {
    lastModelControlAction = { ok: false, label, action, modelKey: model?.key || currentState.activeModelKey, at: new Date().toISOString(), error: error.message };
    throw error;
  }).finally(() => {
    modelControlInFlight = null;
    modelLoadProgress = null;
  });

  activeLatencyBenchmarks.forEach((active) => active.controller.abort());
  await modelControlInFlight;
  return collectDgxModelControl();
}

function readJsonBody(req, maxBytes = 48 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on("data", (chunk) => {
      length += chunk.length;
      if (length > maxBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function sanitizeLatencyInput(input, availableModels) {
  const model = typeof input.model === "string" ? input.model : "";
  const selectedModel = availableModels.find((candidate) => candidate.id === model);
  if (!selectedModel) throw new Error("Select a model currently served by vLLM.");

  const benchmarkType = input.benchmarkType === "visual" ? "visual" : "coding";
  const profiles = benchmarkType === "visual" ? VISUAL_PROMPTS : CODING_PROMPTS;
  const suiteId = typeof input.suiteId === "string" ? input.suiteId : "";
  const suite = suiteId ? CODING_BENCHMARK_SUITES[suiteId] : null;
  if (suiteId && !suite) throw new Error("Unknown benchmark suite.");
  if (suite && benchmarkType !== "coding") throw new Error("Coding suites cannot be used for visual benchmarks.");
  const suiteCaseId = typeof input.suiteCaseId === "string" ? input.suiteCaseId : "";
  const suiteCaseIndex = suite ? suite.cases.findIndex((candidate) => candidate.id === suiteCaseId) : -1;
  const suiteCase = suiteCaseIndex >= 0 ? suite.cases[suiteCaseIndex] : null;
  if (suite && !suiteCase) throw new Error("Unknown benchmark suite case.");
  const requestedSuiteRunId = typeof input.suiteRunId === "string" ? input.suiteRunId : "";
  const suiteRunId = suite && /^suite-[a-z0-9-]{6,64}$/i.test(requestedSuiteRunId) ? requestedSuiteRunId : null;
  if (suite && !suiteRunId) throw new Error("A valid suite run identifier is required.");

  const profile = suiteCase?.profile || (typeof input.profile === "string"
    ? input.profile
    : benchmarkType === "visual" ? "extraction" : "standard");
  const customPrompt = suiteCase ? "" : typeof input.customPrompt === "string" ? input.customPrompt.trim() : "";
  if (benchmarkType === "visual" && !selectedModel.visualCapable) {
    throw new Error("The active model does not support image input. Start an image-capable model before running a visual benchmark.");
  }
  if (benchmarkType === "coding" && profile === "custom" && !customPrompt) throw new Error("Enter a coding prompt for the custom profile.");
  if (customPrompt.length > 12000) throw new Error("Custom prompts are limited to 12,000 characters.");
  if (benchmarkType === "visual" && profile === "custom") throw new Error("Custom prompts are available for coding benchmarks only.");
  if (profile !== "custom" && !profiles[profile]) throw new Error("Unknown prompt profile.");

  const configuredMaxTokens = Number(suiteCase?.maxTokens ?? input.maxTokens);
  const defaultMaxTokens = profile === "custom" ? 512 : profiles[profile].maxTokens;
  const maxTokens = Number.isFinite(configuredMaxTokens)
    ? Math.min(2048, Math.max(64, Math.round(configuredMaxTokens)))
    : defaultMaxTokens;
  const requestedParallel = Number(suiteCase?.parallel ?? input.parallel);
  const parallel = Number.isFinite(requestedParallel)
    ? Math.min(8, Math.max(1, Math.round(requestedParallel)))
    : 1;

  return {
    model,
    modelKey: selectedModel.configuredModelKey || null,
    modelLabel: selectedModel.configuredModelName || selectedModel.label || model,
    benchmarkType,
    profile,
    promptLabel: profile === "custom" ? "Custom coding prompt" : profiles[profile].label,
    prompt: profile === "custom" ? customPrompt : profiles[profile].prompt,
    maxTokens,
    parallel,
    suiteId: suite ? suiteId : null,
    suiteLabel: suite?.label || null,
    suiteRunId,
    suiteCaseId: suiteCase?.id || null,
    suiteCaseLabel: suiteCase?.label || null,
    suiteCaseIndex: suiteCase ? suiteCaseIndex + 1 : null,
    suiteCaseCount: suite?.cases.length || null,
  };
}

function benchmarkMessages({ benchmarkType, prompt }) {
  if (benchmarkType === "visual") {
    return [
      { role: "system", content: "You are a precise visual analysis engineer. Inspect image content carefully, return concise findings, and do not invent objects." },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: VISUAL_BENCHMARK_IMAGE_DATA_URL } },
        ],
      },
    ];
  }
  return [
    { role: "system", content: "You are a concise senior software engineer. Return useful code and implementation notes." },
    { role: "user", content: prompt },
  ];
}

async function streamLatencyProbe({ model, benchmarkType, prompt, maxTokens, index, abortSignal }, onEvent) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 130000);
  const stop = () => controller.abort();
  abortSignal?.addEventListener("abort", stop, { once: true });
  if (abortSignal?.aborted) controller.abort();
  const startedAt = performance.now();
  let firstTokenAt = null;
  let output = "";
  let outputChars = 0;
  let usage = null;

  try {
    const response = await fetch(`${VLLM_API_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: vllmHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        model,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: benchmarkMessages({ benchmarkType, prompt }),
      }),
    });
    if (!response.ok || !response.body) {
      const detail = await response.text();
      throw new Error(`vLLM returned ${response.status}: ${detail.slice(0, 300)}`);
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let completed = false;

    const consumeEvent = (raw) => {
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") {
          if (data === "[DONE]") completed = true;
          continue;
        }
        const payload = safeJsonParse(data, null);
        if (!payload) continue;
        if (payload.usage) usage = payload.usage;
        const delta = payload.choices?.[0]?.delta || {};
        const token = delta.content ?? delta.reasoning_content ?? delta.reasoning ?? "";
        if (!token) continue;
        if (firstTokenAt == null) firstTokenAt = performance.now();
        outputChars += token.length;
        if (output.length < 16000) output += token.slice(0, 16000 - output.length);
        const elapsedSeconds = Math.max(0.001, (performance.now() - (firstTokenAt || startedAt)) / 1000);
        onEvent({
          type: "token",
          index,
          text: token,
          outputChars,
          liveEstimatedTps: (outputChars / 4) / elapsedSeconds,
        });
      }
    };

    while (!completed) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) consumeEvent(event);
    }
    if (buffer) consumeEvent(buffer);

    const finishedAt = performance.now();
    const totalSeconds = (finishedAt - startedAt) / 1000;
    const generationSeconds = firstTokenAt == null ? 0 : (finishedAt - firstTokenAt) / 1000;
    const completionTokens = usage?.completion_tokens ?? Math.max(1, Math.round(outputChars / 4));
    return {
      index,
      ok: true,
      ttftMs: firstTokenAt == null ? null : Math.round(firstTokenAt - startedAt),
      endToEndMs: Math.round(finishedAt - startedAt),
      generationTokensPerSecond: generationSeconds > 0 ? completionTokens / generationSeconds : null,
      completionTokens,
      promptTokens: usage?.prompt_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      outputChars,
      preview: output,
    };
  } catch (error) {
    return {
      index,
      ok: false,
      error: error.name === "AbortError"
        ? (abortSignal?.aborted ? "Stopped from dashboard." : "Benchmark timed out after 130 seconds.")
        : error.message,
    };
  } finally {
    clearTimeout(timeout);
    abortSignal?.removeEventListener("abort", stop);
  }
}

function summarizeLatencyRun(runs) {
  const successful = runs.filter((run) => run.ok);
  const average = (field) => {
    const values = successful.map((run) => run[field]).filter((value) => Number.isFinite(value));
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  };
  return {
    completed: successful.length,
    failed: runs.length - successful.length,
    avgTtftMs: average("ttftMs"),
    avgEndToEndMs: average("endToEndMs"),
    avgGenerationTokensPerSecond: average("generationTokensPerSecond"),
    aggregateGenerationTokensPerSecond: successful.reduce((total, run) => total + (run.generationTokensPerSecond || 0), 0),
    totalPromptTokens: successful.reduce((total, run) => total + (run.promptTokens || 0), 0),
    totalCompletionTokens: successful.reduce((total, run) => total + (run.completionTokens || 0), 0),
  };
}

async function runLatencyBenchmark(config, res) {
  const benchmarkId = `bench-${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  activeLatencyBenchmarks.set(benchmarkId, { controller, startedAt });
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  writeSse(res, "started", { benchmarkId, startedAt, ...config });
  const disconnect = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once("close", disconnect);

  try {
    const runs = await Promise.all(
      Array.from({ length: config.parallel }, (_, index) => streamLatencyProbe(
        { ...config, index: index + 1, abortSignal: controller.signal },
        (event) => writeSse(res, event.type, event),
      )),
    );
    const summary = summarizeLatencyRun(runs);
    const record = {
      id: benchmarkId,
      createdAt: startedAt,
      model: config.model,
      modelKey: config.modelKey,
      modelLabel: config.modelLabel,
      benchmarkType: config.benchmarkType,
      promptLabel: config.promptLabel,
      profile: config.profile,
      maxTokens: config.maxTokens,
      parallel: config.parallel,
      suiteId: config.suiteId,
      suiteLabel: config.suiteLabel,
      suiteRunId: config.suiteRunId || null,
      suiteCaseId: config.suiteCaseId,
      suiteCaseLabel: config.suiteCaseLabel,
      suiteCaseIndex: config.suiteCaseIndex,
      suiteCaseCount: config.suiteCaseCount,
      stopped: controller.signal.aborted,
      historyVersion: 2,
      historyCategory: config.benchmarkType,
      summary,
      runs,
    };
    latencyHistory = [...latencyHistory, normalizeLatencyRecord(record)].slice(-LATENCY_HISTORY_LIMIT);
    // Persist before reporting a successful run to the browser. This prevents
    // a dashboard restart from acknowledging a benchmark that is not durable.
    await saveLatencyHistory();
    if (!res.writableEnded) writeSse(res, "complete", record);
  } finally {
    activeLatencyBenchmarks.delete(benchmarkId);
    res.removeListener("close", disconnect);
    if (!res.writableEnded) res.end();
  }
}

function inferHuggingFaceRepo(model) {
  const root = String(model?.root || "").trim();
  const match = root.match(/models--([^/]+?)--([^/]+?)(?:\/|$)/);
  if (match) return `${match[1]}/${match[2]}`;
  // Local vLLM reports a cache path, while the Docker image reports the
  // canonical Hub repository directly (for example nvidia/Qwen3.6-27B-NVFP4).
  const directRepository = root.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (directRepository) return `${directRepository[1]}/${directRepository[2]}`;
  return null;
}

function cleanTags(tags = []) {
  return tags
    .filter((tag) => !tag.startsWith("region:") && !tag.startsWith("base_model:") && !tag.startsWith("license:"))
    .slice(0, 10);
}

function compactModelDetails(repo, payload) {
  const card = payload?.cardData || {};
  return {
    ok: true,
    repo,
    repoUrl: `https://huggingface.co/${repo}`,
    id: payload?.id || repo,
    author: payload?.author || repo.split("/")[0],
    description: card.description || payload?.description || "",
    provider: card.provider || "",
    baseModel: Array.isArray(card.base_model) ? card.base_model.join(", ") : card.base_model || "",
    license: card.license_name || card.license || payload?.license || "",
    tasks: [...new Set([...(card.validated_tasks || []), ...(card.tasks || [])])].slice(0, 8),
    toolCallingSupported: card.tool_calling_supported === true,
    tags: cleanTags(card.tags?.length ? card.tags : payload?.tags || []),
    downloads: payload?.downloads,
    likes: payload?.likes,
    lastModified: payload?.lastModified,
    parameters: payload?.safetensors?.total,
  };
}

async function fetchHuggingFaceModelDetails(model) {
  const repo = inferHuggingFaceRepo(model);
  if (!repo) return { ok: false, error: "Hugging Face repo could not be inferred from the vLLM model root." };

  const cached = hfModelCache.get(repo);
  if (cached && Date.now() - cached.fetchedAt < HF_CACHE_TTL_MS) return cached.details;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`https://huggingface.co/api/models/${repo}`, {
      signal: controller.signal,
      headers: { "user-agent": "spark-health-dashboard/1.0" },
    });
    if (!response.ok) throw new Error(`Hugging Face returned ${response.status}`);
    const details = compactModelDetails(repo, await response.json());
    hfModelCache.set(repo, { fetchedAt: Date.now(), details });
    return details;
  } catch (error) {
    return {
      ok: false,
      repo,
      repoUrl: `https://huggingface.co/${repo}`,
      error: error.name === "AbortError" ? "Hugging Face metadata request timed out." : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadHistory() {
  const count = Number(historyDb.prepare("SELECT COUNT(*) AS count FROM telemetry_samples").get()?.count || 0);
  if (!count) {
    try {
      const parsed = JSON.parse(await readFile(HISTORY_PATH, "utf8"));
      if (Array.isArray(parsed) && parsed.length) {
        historyDb.exec("BEGIN");
        try {
          const insert = historyDb.prepare(`
            INSERT OR IGNORE INTO telemetry_samples
              (collected_at, model_key, model_id, model_label, model_switch, payload)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          for (const point of parsed) {
            if (!point?.collectedAt) continue;
            insert.run(
              point.collectedAt,
              point.modelKey || null,
              point.modelId || null,
              point.modelLabel || null,
              point.modelSwitch ? 1 : 0,
              JSON.stringify(point),
            );
          }
          historyDb.exec("COMMIT");
        } catch (error) {
          historyDb.exec("ROLLBACK");
          throw error;
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") console.error("Failed to migrate JSON health history", error);
    }
  }

  return historyDb.prepare(`
    SELECT payload
    FROM telemetry_samples
    ORDER BY collected_at DESC
    LIMIT ?
  `).all(HISTORY_LIMIT)
    .reverse()
    .map((row) => safeJsonParse(row.payload, null))
    .filter(Boolean);
}

function saveHistoryPoint(point) {
  historyDb.prepare(`
    INSERT OR REPLACE INTO telemetry_samples
      (collected_at, model_key, model_id, model_label, model_switch, payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    point.collectedAt,
    point.modelKey || null,
    point.modelId || null,
    point.modelLabel || null,
    point.modelSwitch ? 1 : 0,
    JSON.stringify(point),
  );
  historyDb.prepare("DELETE FROM telemetry_samples WHERE collected_at < ?")
    .run(new Date(Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString());
}

async function loadLatencyHistory() {
  try {
    const parsed = JSON.parse(await readFile(LATENCY_HISTORY_PATH, "utf8"));
    if (!Array.isArray(parsed)) return [];
    const normalized = normalizeLatencyHistory(parsed, {
      modelAliases: LEGACY_LATENCY_MODEL_ALIASES,
    }).slice(-LATENCY_HISTORY_LIMIT);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await persistLatencyHistory(normalized);
    }
    return normalized;
  } catch {
    return [];
  }
}

async function persistLatencyHistory(records) {
  await mkdir(DATA_DIR, { recursive: true });
  const temporaryPath = `${LATENCY_HISTORY_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(records.slice(-LATENCY_HISTORY_LIMIT), null, 2));
  await rename(temporaryPath, LATENCY_HISTORY_PATH);
}

async function saveLatencyHistory() {
  await persistLatencyHistory(latencyHistory);
}

function csvLineToGpu(line) {
  const [name, driver, util, power, clock, temp, memUsed, memTotal] = line.split(",").map((part) => part.trim());
  return {
    name,
    driver,
    util: Number(util || 0),
    power: Number(power || 0),
    clock: Number(clock || 0),
    temp: Number(temp || 0),
    memUsed: Number(memUsed || 0),
    memTotal: Number(memTotal || 0),
  };
}

function localCpuTimes() {
  const totals = os.cpus().reduce((result, cpu) => {
    for (const [key, value] of Object.entries(cpu.times)) result[key] = (result[key] || 0) + value / 1000;
    return result;
  }, {});
  return { ...totals, total: Object.values(totals).reduce((sum, value) => sum + value, 0) };
}

async function collectLocalCompute() {
  const [gpu, dockerResult, processResult, modelResult, metricsResult] = await Promise.all([
    collectLiveGpuMetrics(),
    execCommand("bash", ["-lc", "command -v docker >/dev/null 2>&1 && docker ps --format '{{json .}}' || true"], { timeout: 5000 }),
    execCommand("bash", ["-lc", "ps -eo pid,ppid,%cpu,%mem,rss,comm,args | grep -Ei 'vllm|ollama|open-webui|llama|triton|text-generation|VLLM' | grep -Ev 'grep|awk|bash -lc' | head -40 || true"], { timeout: 5000 }),
    fetch(`${VLLM_API_URL}/models`, { headers: vllmHeaders(), signal: AbortSignal.timeout(5000) }).then(async (response) => ({ response, payload: await response.json().catch(() => null) })).catch((error) => ({ error })),
    VLLM_METRICS_URL
      ? fetch(VLLM_METRICS_URL, { signal: AbortSignal.timeout(5000) }).then(async (response) => ({ response, raw: await response.text() })).catch((error) => ({ error }))
      : Promise.resolve({ error: new Error("No metrics URL configured") }),
  ]);
  const vllmModels = Array.isArray(modelResult.payload?.data)
    ? modelResult.payload.data.map((model) => ({
      id: model.id,
      maxModelLen: model.max_model_len,
      ownedBy: model.owned_by,
      root: model.root,
    }))
    : [];
  const loadedVllmModel = identifyServedModel(vllmModels).id
    ? vllmModels.find((model) => model.id === identifyServedModel(vllmModels).id)
    : null;
  const huggingFace = loadedVllmModel ? await fetchHuggingFaceModelDetails(loadedVllmModel) : null;
  const totalMemory = os.totalmem();
  const availableMemory = os.freemem();

  return {
    ok: true,
    host: "local",
    collectedAt: new Date().toISOString(),
    summary: {
      hostname: os.hostname(),
      user: os.userInfo().username,
      time: Date.now() / 1000,
      uptimeSeconds: os.uptime(),
      loadavg: os.loadavg().join(" "),
      uname: { system: os.type(), release: os.release(), machine: os.machine() },
      os: { NAME: os.type(), PRETTY_NAME: `${os.type()} ${os.release()}` },
      meminfo: { MemTotal: totalMemory, MemAvailable: availableMemory },
      cpuTimes: localCpuTimes(),
      networkBytes: {},
      diskBytes: {},
    },
    gpu,
    docker: dockerResult.stdout.trim().split("\n").filter(Boolean).map((line) => safeJsonParse(line, { raw: line })),
    processes: parsePs(processResult.stdout),
    vllm: {
      ok: Boolean(modelResult.response?.ok && vllmModels.length),
      loadedModel: loadedVllmModel,
      models: vllmModels,
      huggingFace,
      metrics: metricsResult.response?.ok ? buildVllmMetrics(metricsResult.raw) : { available: false },
      error: modelResult.error?.message || (!modelResult.response?.ok ? `Model endpoint returned ${modelResult.response?.status || "no response"}` : null),
    },
    latestSparkDoctor: { path: "", data: null },
  };
}

async function collectDgx() {
  if (CONFIG.compute.connection === "local") return collectLocalCompute();
  const remote = String.raw`
set -e
python3 - <<'PY'
import json, os, pathlib, platform, re, time
def meminfo():
    vals = {}
    try:
        for line in open('/proc/meminfo'):
            k, v = line.split(':', 1)
            vals[k] = int(v.strip().split()[0]) * 1024
    except Exception:
        pass
    return vals
def cpu_times():
    try:
        fields = [int(value) for value in open('/proc/stat').readline().split()[1:]]
        ticks = os.sysconf(os.sysconf_names['SC_CLK_TCK'])
        labels = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal']
        values = {label: (fields[index] / ticks if index < len(fields) else 0) for index, label in enumerate(labels)}
        values['total'] = sum(fields) / ticks
        return values
    except Exception:
        return {}
def network_bytes():
    rx = tx = 0
    try:
        for line in open('/proc/net/dev').read().splitlines()[2:]:
            interface, values = line.split(':', 1)
            if interface.strip() == 'lo':
                continue
            fields = values.split()
            rx += int(fields[0])
            tx += int(fields[8])
    except Exception:
        pass
    return {'rx': rx, 'tx': tx}
def disk_bytes():
    read_bytes = write_bytes = 0
    try:
        for line in open('/proc/diskstats'):
            fields = line.split()
            if len(fields) < 14 or not re.match(r'^(nvme\d+n\d+|sd[a-z]+|vd[a-z]+)$', fields[2]):
                continue
            read_bytes += int(fields[5]) * 512
            write_bytes += int(fields[9]) * 512
    except Exception:
        pass
    return {'read': read_bytes, 'write': write_bytes}
def os_release():
    vals = {}
    try:
        for line in open('/etc/os-release'):
            if '=' in line:
                k, v = line.rstrip().split('=', 1)
                vals[k] = v.strip('"')
    except Exception:
        pass
    return vals
print(json.dumps({
    "hostname": platform.node(),
    "user": os.environ.get("USER"),
    "time": time.time(),
    "uptimeSeconds": float(open('/proc/uptime').read().split()[0]),
    "loadavg": open('/proc/loadavg').read().strip(),
    "uname": platform.uname()._asdict(),
    "os": os_release(),
    "meminfo": meminfo(),
    "cpuTimes": cpu_times(),
    "networkBytes": network_bytes(),
    "diskBytes": disk_bytes(),
}))
PY
echo __GPU__
nvidia-smi --query-gpu=name,driver_version,utilization.gpu,power.draw,clocks.current.graphics,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null || true
echo __DOCKER__
docker ps --format '{{json .}}' 2>/dev/null || true
echo __PROCS__
ps -eo pid,ppid,%cpu,%mem,rss,comm,args | grep -Ei 'vllm|ollama|open-webui|llama|triton|text-generation|VLLM' | grep -Ev 'grep|awk|bash -lc|python3 - <<' | head -40
echo __LATEST_SPARK_DOCTOR__
echo __VLLM_MODELS__
VLLM_PROBE_HOST="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
if [ -n "$VLLM_PROBE_HOST" ]; then
  export VLLM_PROBE_BASE="http://$VLLM_PROBE_HOST:${MODEL_CONTROLLER_PORT}"
else
  export VLLM_PROBE_BASE="http://127.0.0.1:${MODEL_CONTROLLER_PORT}"
fi
python3 - <<'PY' 2>/dev/null || true
import os
import pathlib
import urllib.request
try:
    key_path = pathlib.Path('${CONTROLLER_PATHS.apiKey}')
    headers = {'Authorization': 'Bearer ' + key_path.read_text().strip()} if key_path.is_file() else {}
    request = urllib.request.Request(os.environ['VLLM_PROBE_BASE'] + '/v1/models', headers=headers)
    with urllib.request.urlopen(request, timeout=3) as response:
        print(response.read().decode())
except Exception:
    pass
PY
echo __VLLM_METRICS__
python3 - <<'PY' 2>/dev/null || true
import os
import urllib.request
try:
    with urllib.request.urlopen(os.environ['VLLM_PROBE_BASE'] + '/metrics', timeout=5) as response:
        print(response.read().decode())
except Exception:
    pass
PY
`;

  const res = await runOnCompute(remote, 20000);
  if (!res.ok) {
    return { ok: false, host: DGX_HOST, error: res.stderr || res.message, collectedAt: new Date().toISOString() };
  }

  const [summaryRaw, afterGpu = ""] = res.stdout.split("__GPU__\n");
  const [gpuRaw = "", afterDocker = ""] = afterGpu.split("__DOCKER__\n");
  const [dockerRaw = "", afterProcs = ""] = afterDocker.split("__PROCS__\n");
  const [procsRaw = "", afterLatest = ""] = afterProcs.split("__LATEST_SPARK_DOCTOR__\n");
  const [latestRaw = "", afterVllmModels = ""] = afterLatest.split("__VLLM_MODELS__\n");
  const [vllmRaw = "", vllmMetricsRaw = ""] = afterVllmModels.split("__VLLM_METRICS__\n");
  const summary = safeJsonParse(summaryRaw.trim().split("\n").at(-1), {});
  const gpu = gpuRaw.trim().split("\n").filter(Boolean).map(csvLineToGpu);
  const docker = dockerRaw.trim().split("\n").filter(Boolean).map((line) => safeJsonParse(line, { raw: line }));
  const latestLines = latestRaw.trim().split("\n");
  const latestPath = latestLines[0] || "";
  const latestJson = latestLines.length > 1 ? safeJsonParse(latestLines.slice(1).join("\n"), null) : null;
  const vllmResponse = safeJsonParse(vllmRaw.trim(), null);
  const vllmModels = Array.isArray(vllmResponse?.data)
    ? vllmResponse.data.map((model) => ({
      id: model.id,
      maxModelLen: model.max_model_len,
      ownedBy: model.owned_by,
      root: model.root,
    }))
    : [];
  const canonicalServedNames = new Set(DGX_MODEL_CATALOG.map((model) => model.servedNames.at(-1)));
  const loadedVllmModel = vllmModels.find((model) => canonicalServedNames.has(model.id))
    || vllmModels.find((model) => model.id !== "qwen3-14b")
    || vllmModels[0]
    || null;
  const huggingFace = loadedVllmModel ? await fetchHuggingFaceModelDetails(loadedVllmModel) : null;

  return {
    ok: true,
    host: DGX_HOST,
    collectedAt: new Date().toISOString(),
    summary,
    gpu,
    docker,
    processes: parsePs(procsRaw),
    vllm: {
      ok: vllmModels.length > 0,
      loadedModel: loadedVllmModel,
      models: vllmModels,
      huggingFace,
      metrics: buildVllmMetrics(vllmMetricsRaw),
    },
    latestSparkDoctor: {
      path: latestPath,
      data: latestJson,
    },
  };
}

function parsePs(raw) {
  const lines = raw.trim().split("\n").filter(Boolean);
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/, 7);
    return {
      pid: Number(parts[0]),
      ppid: Number(parts[1]),
      cpu: Number(parts[2]),
      mem: Number(parts[3]),
      rssMb: Math.round(Number(parts[4]) / 1024),
      command: parts[5],
      args: parts[6] || line,
    };
  });
}

async function collectPm2() {
  if (!CONFIG.capabilities.pm2) {
    return { ok: true, enabled: false, host: null, collectedAt: new Date().toISOString(), processes: [] };
  }
  if (CONFIG.services.pm2.connection === "local" || MAC_MINI_HOST === "local" || MAC_MINI_HOST === "self") {
    const local = await execCommand("bash", ["-lc", "export PATH=\"/opt/homebrew/bin:/usr/local/bin:$PATH\"; command -v pm2 >/dev/null 2>&1 || { echo __NO_PM2__; exit 0; }; pm2 jlist"], { timeout: 12000 });
    if (!local.ok) {
      return {
        ok: false,
        host: "local",
        collectedAt: new Date().toISOString(),
        error: local.stderr || local.message,
      };
    }
    if (local.stdout.includes("__NO_PM2__")) {
      return { ok: false, host: "local", collectedAt: new Date().toISOString(), error: "pm2 was not found on this host." };
    }
    const list = safeJsonParse(local.stdout, []);
    return formatPm2List("local", list);
  }

  const remote = String.raw`
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v pm2 >/dev/null 2>&1 || { echo __NO_PM2__; exit 0; }
pm2 jlist
`;
  const res = await ssh(MAC_MINI_HOST, remote, 12000);
  if (!res.ok) {
    return {
      ok: false,
      host: MAC_MINI_HOST,
      collectedAt: new Date().toISOString(),
      error: res.stderr || res.message,
      setup: "Set MAC_MINI_HOST to a reachable SSH alias with passwordless access, then restart the dashboard.",
    };
  }
  if (res.stdout.includes("__NO_PM2__")) {
    return { ok: false, host: MAC_MINI_HOST, collectedAt: new Date().toISOString(), error: "pm2 was not found on the remote host." };
  }
  return formatPm2List(MAC_MINI_HOST, safeJsonParse(res.stdout, []));
}

async function collectGateway() {
  if (!CONFIG.capabilities.gateway) {
    return { ok: true, enabled: false, endpoint: null, models: [], collectedAt: new Date().toISOString() };
  }
  const endpoint = `${AGENT_GATEWAY_API_URL}/models`;
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Gateway returned HTTP ${response.status}`);
    const payload = await response.json();
    const models = Array.isArray(payload?.data) ? payload.data : [];
    return {
      ok: true,
      endpoint,
      latencyMs: Date.now() - startedAt,
      models: models.map((model) => model.id).filter(Boolean),
      collectedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      latencyMs: Date.now() - startedAt,
      models: [],
      collectedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Gateway health check failed.",
    };
  }
}

function formatPm2List(host, list) {
  return {
    ok: true,
    host,
    collectedAt: new Date().toISOString(),
    processes: list.map((proc) => ({
      id: proc.pm_id,
      name: proc.name,
      status: proc.pm2_env?.status,
      restarts: proc.pm2_env?.restart_time,
      uptime: proc.pm2_env?.pm_uptime,
      cpu: proc.monit?.cpu,
      memoryMb: Math.round((proc.monit?.memory || 0) / 1024 / 1024),
      version: proc.pm2_env?.version,
      mode: proc.pm2_env?.exec_mode,
    })),
  };
}

function historyPoint(snapshot) {
  const gpu = snapshot.dgx?.gpu?.[0] || {};
  const mem = snapshot.dgx?.summary?.meminfo || {};
  const totalGb = bytesToGb(mem.MemTotal);
  const availGb = bytesToGb(mem.MemAvailable);
  const usedPct = totalGb ? ((totalGb - availGb) / totalGb) * 100 : null;
  const findings = snapshot.dgx?.latestSparkDoctor?.data?.findings || [];
  const pm2Processes = snapshot.pm2?.processes || [];
  const onlinePm2 = pm2Processes.filter((proc) => proc.status === "online").length;
  const modelProcesses = snapshot.dgx?.processes || [];
  const vllm = snapshot.dgx?.vllm?.metrics;
  const previous = history.at(-1);
  const modelIdentity = identifyServedModel(snapshot.dgx?.vllm?.models || []);
  const modelSwitch = Boolean(previous?.modelId && modelIdentity.id && previous.modelId !== modelIdentity.id);
  const previousModelSample = !modelSwitch && previous?.modelId === modelIdentity.id ? previous : null;
  const latencyThresholds = MODEL_LATENCY_THRESHOLDS[modelIdentity.key] || DEFAULT_LATENCY_THRESHOLDS;
  const elapsedSeconds = previous?.collectedAt
    ? (new Date(snapshot.collectedAt).getTime() - new Date(previous.collectedAt).getTime()) / 1000
    : null;
  const rate = (current, previousValue) => {
    if (!Number.isFinite(current) || !Number.isFinite(previousValue) || !elapsedSeconds || elapsedSeconds <= 0 || current < previousValue) return null;
    return (current - previousValue) / elapsedSeconds;
  };
  const cpuTimes = snapshot.dgx?.summary?.cpuTimes || {};
  const networkBytes = snapshot.dgx?.summary?.networkBytes || {};
  const diskBytes = snapshot.dgx?.summary?.diskBytes || {};
  const previousCpu = previous?.cpuTimes || {};
  const cpuDelta = Number.isFinite(cpuTimes.total) && Number.isFinite(previousCpu.total)
    ? cpuTimes.total - previousCpu.total
    : null;
  const cpuPercent = (...fields) => {
    if (!Number.isFinite(cpuDelta) || cpuDelta <= 0) return null;
    const current = fields.reduce((total, field) => total + (cpuTimes[field] || 0), 0);
    const prior = fields.reduce((total, field) => total + (previousCpu[field] || 0), 0);
    return Math.max(0, ((current - prior) / cpuDelta) * 100);
  };
  const latency = vllm?.latency || {};
  const spec = vllm?.speculative || {};

  return {
    collectedAt: snapshot.collectedAt,
    modelKey: modelIdentity.key,
    modelId: modelIdentity.id,
    modelLabel: modelIdentity.label,
    modelRepository: modelIdentity.repository,
    modelSwitch,
    previousModelId: modelSwitch ? previous.modelId : null,
    latencyThresholds,
    dgxOk: snapshot.dgx?.ok !== false,
    pm2Ok: snapshot.pm2?.ok === true,
    healthScore: snapshot.dgx?.ok !== false && snapshot.pm2?.ok === true && !findings.length ? 100 : 0,
    sparkDoctorFindings: findings.length,
    gpuUtil: Number.isFinite(gpu.util) ? gpu.util : null,
    gpuPower: Number.isFinite(gpu.power) ? gpu.power : null,
    gpuTemp: Number.isFinite(gpu.temp) ? gpu.temp : null,
    memoryUsedPct: usedPct,
    memoryAvailableGb: availGb || null,
    memoryUsedGb: totalGb ? totalGb - availGb : null,
    memoryCachedGb: bytesToGb((mem.Cached || 0) + (mem.SReclaimable || 0)),
    cpuTimes,
    cpuUserPct: cpuPercent("user", "nice"),
    cpuSystemPct: cpuPercent("system", "irq", "softirq"),
    cpuIowaitPct: cpuPercent("iowait"),
    networkRxBytes: networkBytes.rx ?? null,
    networkTxBytes: networkBytes.tx ?? null,
    networkRxBytesPerSecond: rate(networkBytes.rx, previous?.networkRxBytes),
    networkTxBytesPerSecond: rate(networkBytes.tx, previous?.networkTxBytes),
    diskReadBytes: diskBytes.read ?? null,
    diskWriteBytes: diskBytes.write ?? null,
    diskReadBytesPerSecond: rate(diskBytes.read, previous?.diskReadBytes),
    diskWriteBytesPerSecond: rate(diskBytes.write, previous?.diskWriteBytes),
    dockerRunning: snapshot.dgx?.docker?.length || 0,
    modelProcessCount: modelProcesses.length,
    modelRssMb: modelProcesses.reduce((total, proc) => total + (proc.rssMb || 0), 0),
    pm2Online: onlinePm2,
    pm2Total: pm2Processes.length,
    pm2Cpu: pm2Processes.reduce((total, proc) => total + (proc.cpu || 0), 0),
    pm2MemoryMb: pm2Processes.reduce((total, proc) => total + (proc.memoryMb || 0), 0),
    promptTokensTotal: vllm?.promptTokens ?? null,
    generationTokensTotal: vllm?.generationTokens ?? null,
    totalTokens: vllm?.totalTokens ?? null,
    requestTotal: vllm?.requests?.total ?? null,
    promptTokensPerSecond: rate(vllm?.promptTokens, previousModelSample?.promptTokensTotal),
    generationTokensPerSecond: rate(vllm?.generationTokens, previousModelSample?.generationTokensTotal),
    requestsPerSecond: rate(vllm?.requests?.total, previousModelSample?.requestTotal),
    vllmRunning: vllm?.queue?.running ?? null,
    vllmWaiting: vllm?.queue?.waiting ?? null,
    kvCacheUsagePct: vllm?.cache?.kvUsagePct ?? null,
    prefixCacheHitRatePct: vllm?.cache?.prefixHitRatePct ?? null,
    ttftP50Seconds: latency.ttft?.p50Seconds ?? null,
    ttftP95Seconds: latency.ttft?.p95Seconds ?? latency.ttftP95Seconds ?? null,
    ttftP99Seconds: latency.ttft?.p99Seconds ?? null,
    queueP50Seconds: latency.queue?.p50Seconds ?? null,
    queueP95Seconds: latency.queue?.p95Seconds ?? latency.queueP95Seconds ?? null,
    queueP99Seconds: latency.queue?.p99Seconds ?? null,
    e2eP50Seconds: latency.e2e?.p50Seconds ?? null,
    e2eP95Seconds: latency.e2e?.p95Seconds ?? latency.e2eP95Seconds ?? null,
    e2eP99Seconds: latency.e2e?.p99Seconds ?? null,
    interTokenP50Seconds: latency.interToken?.p50Seconds ?? null,
    interTokenP95Seconds: latency.interToken?.p95Seconds ?? latency.interTokenP95Seconds ?? null,
    interTokenP99Seconds: latency.interToken?.p99Seconds ?? null,
    specDraftTokens: spec.draftTokens ?? null,
    specAcceptedTokens: spec.acceptedTokens ?? null,
    specAcceptanceRatePct: spec.acceptanceRatePct ?? null,
    modelsEndpointLatencyMs: snapshot.liveVllm?.metrics?.endpoints?.models?.latencyMs ?? null,
    modelsEndpointOk: snapshot.liveVllm?.metrics?.endpoints?.models?.ok ?? null,
    metricsEndpointLatencyMs: snapshot.liveVllm?.metrics?.endpoints?.metrics?.latencyMs ?? null,
    syntheticCompletionOk: snapshot.liveVllm?.metrics?.endpoints?.syntheticCompletion?.ok ?? null,
    syntheticCompletionLatencyMs: snapshot.liveVllm?.metrics?.endpoints?.syntheticCompletion?.latencyMs ?? null,
  };
}

function bytesToGb(bytes) {
  return Number(bytes || 0) / 1024 / 1024 / 1024;
}

async function collectAll() {
  const [dgx, pm2, gateway, sparkDoctor] = await Promise.all([
    collectDgx(),
    collectPm2(),
    collectGateway(),
    collectSparkDoctorStatus(),
  ]);
  dgx.sparkDoctor = sparkDoctor;
  if (sparkDoctor.latest?.path) dgx.latestSparkDoctor = sparkDoctor.latest;
  const liveVllm = await collectLiveVllmMetrics();
  const runtimeConfig = publicConfig(CONFIG);
  runtimeConfig.capabilities = {
    ...runtimeConfig.capabilities,
    sparkDoctor: Boolean(sparkDoctor.available),
  };
  lastSnapshot = { collectedAt: new Date().toISOString(), config: runtimeConfig, dgx, pm2, gateway, liveVllm };
  const point = historyPoint(lastSnapshot);
  history = [...history, point].slice(-HISTORY_LIMIT);
  try {
    saveHistoryPoint(point);
  } catch (error) {
    console.error("Failed to save health history", error);
  }
  return lastSnapshot;
}

async function runSparkDoctor() {
  const installation = await collectSparkDoctorStatus();
  if (!installation.available) {
    const error = new Error(installation.reason || "Spark Doctor is disabled or unavailable.");
    error.status = 503;
    throw error;
  }
  if (runInFlight) return runInFlight;
  const encodedDirectory = Buffer.from(installation.directory, "utf8").toString("base64");
  const encodedExecutable = Buffer.from(installation.executable, "utf8").toString("base64");
  const encodedRunsDirectory = Buffer.from(`${CONTROLLER_HOME}/spark-doctor-runs`, "utf8").toString("base64");
  const remote = String.raw`
set -e
directory=$(printf '%s' '${encodedDirectory}' | base64 -d)
executable=$(printf '%s' '${encodedExecutable}' | base64 -d)
runs_directory=$(printf '%s' '${encodedRunsDirectory}' | base64 -d)
cd "$directory"
run_dir="$runs_directory/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$run_dir"
set +e
"$executable" scan --json "$run_dir/scan.json" --markdown "$run_dir/report.md" >/tmp/spark-doctor-dashboard.log 2>&1
status=$?
set -e
python3 - "$run_dir" "$status" <<'PY'
import json, pathlib, sys
run_dir = pathlib.Path(sys.argv[1])
status = int(sys.argv[2])
scan_path = run_dir / "scan.json"
report_path = run_dir / "report.md"
payload = {
    "exitCode": status,
    "runDir": str(run_dir),
    "scanPath": str(scan_path),
    "reportPath": str(report_path),
    "scan": json.loads(scan_path.read_text()) if scan_path.exists() else None,
    "report": report_path.read_text() if report_path.exists() else "",
}
print(json.dumps(payload))
PY
exit 0
`;

  runInFlight = runOnCompute(remote, 120000).then((res) => {
    if (!res.ok) {
      lastSparkDoctorRun = redactSensitiveData({ ok: false, collectedAt: new Date().toISOString(), error: res.stderr || res.message });
      return lastSparkDoctorRun;
    }
    lastSparkDoctorRun = redactSensitiveData({
      ok: true,
      collectedAt: new Date().toISOString(),
      ...safeJsonParse(res.stdout, { raw: res.stdout }),
    });
    return lastSparkDoctorRun;
  }).finally(() => {
    runInFlight = null;
  });
  return runInFlight;
}

async function sendJson(res, status, data) {
  // Treat every API response as a security boundary. System collectors and
  // model diagnostics can contain credentials in command lines or nested data.
  const body = JSON.stringify(redactSensitiveData(data), null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function serveStatic(req, res) {
  let pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/") pathname = "/index.html";
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(DIST, safePath);
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".png": "image/png",
      ".ico": "image/x-icon",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".webmanifest": "application/manifest+json; charset=utf-8",
    };
    const type = contentTypes[ext] || "application/octet-stream";
    res.writeHead(200, staticResponseHeaders(pathname, type));
    res.end(data);
  } catch {
    const data = await readFile(join(DIST, "index.html"));
    res.writeHead(200, staticResponseHeaders(pathname, "text/html; charset=utf-8", { fallback: true }));
    res.end(data);
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/config") {
      return sendJson(res, 200, publicConfig(CONFIG));
    }
    if (url.pathname === "/api/settings") {
      if (req.method === "GET") return sendJson(res, 200, settingsResponse(CONFIG));
      if (req.method === "POST") {
        assertSettingsAccess(req);
        try {
          return sendJson(res, 200, await saveEditableSettings(CONFIG, await readJsonBody(req)));
        } catch (error) {
          return sendJson(res, 400, { error: error.message });
        }
      }
      return sendJson(res, 405, { error: "Method not allowed." });
    }
    if (url.pathname === "/api/status") {
      const refresh = url.searchParams.get("refresh") === "1";
      const data = refresh || !lastSnapshot ? await collectAll() : lastSnapshot;
      return sendJson(res, 200, data);
    }
    if (url.pathname === "/api/history") {
      return sendJson(res, 200, {
        limit: HISTORY_LIMIT,
        retentionDays: HISTORY_RETENTION_DAYS,
        storage: "sqlite",
        points: history,
      });
    }
    if (url.pathname === "/api/vllm/live") {
      return sendJson(res, 200, await collectLiveVllmMetrics());
    }
    if (url.pathname === "/api/models/control") {
      if (req.method === "GET") {
        if (!CONFIG.capabilities.modelControl) {
          return sendJson(res, 200, { ok: false, disabled: true, error: "Model control is disabled for this dashboard profile.", models: [] });
        }
        return sendJson(res, 200, await collectDgxModelControl());
      }
      if (req.method === "POST") {
        assertWriteAccess(req);
        if (!CONFIG.capabilities.modelControl) return sendJson(res, 403, { error: "Model control is disabled." });
        return sendJson(res, 200, await runDgxModelControl(await readJsonBody(req)));
      }
      return sendJson(res, 405, { error: "Method not allowed." });
    }
    if (url.pathname === "/api/latency/models") {
      return sendJson(res, 200, { profiles: CODING_PROMPTS, visualProfiles: VISUAL_PROMPTS, codingSuites: CODING_BENCHMARK_SUITES, ...(await fetchVllmModels()) });
    }
    if (url.pathname === "/api/latency/history") {
      latencyHistory = await loadLatencyHistory();
      return sendJson(res, 200, { limit: LATENCY_HISTORY_LIMIT, runs: latencyHistory.slice().reverse() });
    }
    if (url.pathname === "/api/latency/stop" && req.method === "POST") {
      assertWriteAccess(req);
      if (!CONFIG.capabilities.benchmarks) return sendJson(res, 403, { error: "Benchmarks are disabled." });
      const { benchmarkId } = await readJsonBody(req);
      const active = activeLatencyBenchmarks.get(benchmarkId);
      if (!active) return sendJson(res, 404, { error: "That benchmark is no longer active." });
      active.controller.abort();
      return sendJson(res, 200, { ok: true, stopped: [benchmarkId] });
    }
    if (url.pathname === "/api/latency/kill-all" && req.method === "POST") {
      assertWriteAccess(req);
      if (!CONFIG.capabilities.benchmarks) return sendJson(res, 403, { error: "Benchmarks are disabled." });
      const stopped = [...activeLatencyBenchmarks.keys()];
      activeLatencyBenchmarks.forEach((active) => active.controller.abort());
      return sendJson(res, 200, { ok: true, stopped });
    }
    if (url.pathname === "/api/latency/run" && req.method === "POST") {
      assertWriteAccess(req);
      if (!CONFIG.capabilities.benchmarks) return sendJson(res, 403, { error: "Benchmarks are disabled." });
      const discovered = await fetchVllmModels();
      if (!discovered.ok) return sendJson(res, 503, { error: discovered.error || "vLLM model discovery failed." });
      const body = await readJsonBody(req);
      let config;
      try {
        config = sanitizeLatencyInput(body, discovered.models);
      } catch (error) {
        return sendJson(res, 400, { error: error.message });
      }
      return runLatencyBenchmark(config, res);
    }
    if (url.pathname === "/api/spark-doctor/run" && req.method === "POST") {
      assertWriteAccess(req);
      const result = await runSparkDoctor();
      await collectAll();
      return sendJson(res, 200, result);
    }
    if (url.pathname === "/api/spark-doctor/latest") {
      return sendJson(res, 200, lastSparkDoctorRun || { ok: false, message: "No dashboard-triggered run yet." });
    }
    if (url.pathname.startsWith("/api/")) {
      return sendJson(res, 404, { error: "Not found" });
    }
    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message, stack: error.status ? undefined : error.stack });
  }
}).listen(PORT, HOST, () => {
  console.log(`${CONFIG.dashboard.title} listening on http://${HOST}:${PORT}`);
  console.log(`Profile=${CONFIG.profile} mode=${CONFIG.dashboard.mode} compute=${CONFIG.compute.connection}:${DGX_HOST}`);
});

setTimeout(maybeRunSyntheticCompletionProbe, 15000).unref();
setInterval(maybeRunSyntheticCompletionProbe, 60 * 1000).unref();
