import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLatencyHistory, normalizeLatencyRecord } from "../server/latency-history.js";

test("legacy coding records are retained and categorized", () => {
  const record = normalizeLatencyRecord({
    id: "legacy-coding",
    model: "qwen3-14b",
    profile: "standard",
    maxTokens: "512",
    parallel: "1",
    summary: { avgGenerationTokensPerSecond: 42 },
  }, { modelAliases: new Map([["qwen3-14b", "qwen3.6-35b-a3b-nvfp4"]]) });

  assert.equal(record.model, "qwen3.6-35b-a3b-nvfp4");
  assert.equal(record.benchmarkType, "coding");
  assert.equal(record.historyCategory, "coding");
  assert.equal(record.legacy, true);
  assert.equal(record.maxTokens, 512);
  assert.equal(record.parallel, 1);
});

test("legacy visual profiles stay separate from coding history", () => {
  const record = normalizeLatencyRecord({ id: "legacy-visual", model: "omni", profile: "extraction" });
  assert.equal(record.benchmarkType, "visual");
  assert.equal(record.historyCategory, "visual");
  assert.equal(record.suiteId, null);
});

test("history normalization removes duplicate persisted records without dropping distinct cases", () => {
  const records = normalizeLatencyHistory([
    { id: "same", model: "model-a", profile: "standard" },
    { id: "same", model: "model-a", profile: "standard" },
    { id: "other", model: "model-a", profile: "standard" },
  ]);
  assert.deepEqual(records.map(({ id }) => id), ["same", "other"]);
});

test("new benchmark records retain inference and presentation snapshots", () => {
  const record = normalizeLatencyRecord({
    id: "mtp3-run",
    historyVersion: 3,
    model: "qwen3.8-27b-nvfp4",
    inferenceConfig: {
      precision: "NVFP4 / FP8 mixed",
      contextTokens: 65536,
      maxNumSeqs: 4,
      kvCache: "8 GB FP8",
      speculativeDecoding: { method: "MTP", draftTokens: 3 },
    },
    modelPresentation: {
      key: "qwen38-nvfp4",
      id: "qwen3.8-27b-nvfp4",
      displayName: "Qwen 3.8 27B NVFP4",
      providerLogo: "qwen",
      cacheDirectory: "models--qwen--removed-from-history",
    },
  });

  assert.equal(record.historyVersion, 4);
  assert.equal(record.legacy, false);
  assert.deepEqual(record.inferenceConfig.speculativeDecoding, { method: "MTP", draftTokens: 3 });
  assert.equal(record.modelPresentation.displayName, "Qwen 3.8 27B NVFP4");
  assert.equal(record.modelPresentation.providerLogo, "qwen");
  assert.equal("cacheDirectory" in record.modelPresentation, false);
});

test("version two records stay supported when inference configuration was not recorded", () => {
  const record = normalizeLatencyRecord({ id: "v2-run", historyVersion: 2, model: "older-model" });
  assert.equal(record.historyVersion, 4);
  assert.equal(record.legacy, false);
  assert.equal(record.inferenceConfig, null);
});
