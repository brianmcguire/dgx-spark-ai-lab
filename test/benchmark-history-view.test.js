import test from "node:test";
import assert from "node:assert/strict";
import { bestComparableSingleCodingView, catalogModelPresentations, inferenceConfigLabel, initialCodingBenchmarkView, speculativeDecodingLabel, summarizeBenchmarkModels } from "../src/benchmark-history.js";

const suite = { cases: [{ id: "a" }, { id: "b" }] };

test("legacy coding history opens in a compatible single-run leaderboard", () => {
  const view = initialCodingBenchmarkView([{
    historyCategory: "coding",
    suiteId: null,
    profile: "standard",
    maxTokens: 512,
    parallel: 1,
  }], { standardCodingV1: suite });
  assert.deepEqual(view, { benchmarkPlan: "single", profile: "standard", maxTokens: 512, parallel: 1 });
});

test("a complete current suite remains the default leaderboard", () => {
  const history = ["a", "b"].map((suiteCaseId) => ({
    historyCategory: "coding",
    suiteId: "standardCodingV1",
    suiteRunId: "run-1",
    suiteCaseId,
    parallel: 1,
    summary: { completed: 1, failed: 0 },
  }));
  assert.deepEqual(initialCodingBenchmarkView(history, { standardCodingV1: suite }), { benchmarkPlan: "standardCodingV1" });
});

test("saved model history remains visible independently of leaderboard filters", () => {
  const history = [
    { model: "model-a", historyCategory: "coding", profile: "quick", maxTokens: 256, parallel: 1, createdAt: "2026-08-01T10:00:00Z", summary: { completed: 1, failed: 0, avgGenerationTokensPerSecond: 40 } },
    { model: "model-a", historyCategory: "coding", profile: "standard", maxTokens: 512, parallel: 1, createdAt: "2026-08-02T10:00:00Z", summary: { completed: 1, failed: 0, avgGenerationTokensPerSecond: 50 } },
    { model: "model-b", modelKey: "catalog-b", modelLabel: "Model B", historyCategory: "coding", suiteId: "standardCodingV1", suiteRunId: "suite-b", suiteCaseId: "a", createdAt: "2026-08-03T10:00:00Z", summary: { completed: 1, failed: 0, avgGenerationTokensPerSecond: 35 } },
    { model: "visual-a", historyCategory: "visual", profile: "extraction", createdAt: "2026-08-04T10:00:00Z", summary: { completed: 1, failed: 0, avgGenerationTokensPerSecond: 12 } },
  ];

  assert.deepEqual(summarizeBenchmarkModels(history).map((item) => ({
    key: item.key,
    records: item.records,
    completed: item.completed,
    configurations: item.configurations,
    bestTps: item.bestTps,
  })), [
    { key: "catalog-b", records: 1, completed: 1, configurations: 1, bestTps: 35 },
    { key: "model-a", records: 2, completed: 2, configurations: 2, bestTps: 50 },
  ]);
});

test("the default single-run comparison favors the configuration covering the most models", () => {
  const history = [
    { model: "model-a", historyCategory: "coding", profile: "quick", maxTokens: 128, parallel: 1, createdAt: "2026-08-04T10:00:00Z", summary: { completed: 1, failed: 0, avgGenerationTokensPerSecond: 50 } },
    { model: "model-a", historyCategory: "coding", profile: "standard", maxTokens: 512, parallel: 1, createdAt: "2026-08-01T10:00:00Z", summary: { completed: 1, failed: 0, avgGenerationTokensPerSecond: 40 } },
    { model: "model-b", historyCategory: "coding", profile: "standard", maxTokens: 512, parallel: 1, createdAt: "2026-08-02T10:00:00Z", summary: { completed: 1, failed: 0, avgGenerationTokensPerSecond: 45 } },
  ];

  assert.deepEqual(bestComparableSingleCodingView(history), {
    benchmarkPlan: "single",
    profile: "standard",
    maxTokens: 512,
    parallel: 1,
  });
});

test("provider presentation resolves catalog keys, canonical ids, and served aliases", () => {
  const nvidia = { key: "nvidia-model", id: "canonical-model", servedNames: ["alias", "canonical-model"], providerLogo: "nvidia" };
  const presentation = catalogModelPresentations([nvidia]);

  assert.equal(presentation.get("nvidia-model"), nvidia);
  assert.equal(presentation.get("canonical-model"), nvidia);
  assert.equal(presentation.get("alias"), nvidia);
});

test("saved history merges legacy served names with newer catalog identities", () => {
  const catalogModel = {
    key: "nvidia-nemotron",
    id: "nemotron-repository",
    label: "Nemotron",
    servedNames: ["application-alias", "nemotron-served"],
  };
  const history = [
    {
      model: "nemotron-served",
      historyCategory: "coding",
      profile: "standard",
      maxTokens: 512,
      parallel: 1,
      createdAt: "2026-08-01T10:00:00Z",
      summary: { completed: 1, failed: 0, avgGenerationTokensPerSecond: 50 },
    },
    {
      model: "nemotron-served",
      modelKey: "nvidia-nemotron",
      modelLabel: "Nemotron",
      historyCategory: "coding",
      profile: "standard",
      maxTokens: 512,
      parallel: 1,
      createdAt: "2026-08-02T10:00:00Z",
      summary: { completed: 1, failed: 0, avgGenerationTokensPerSecond: 55 },
    },
  ];

  assert.deepEqual(summarizeBenchmarkModels(history, "coding", [catalogModel]).map((item) => ({
    key: item.key,
    modelKey: item.modelKey,
    label: item.modelLabel,
    records: item.records,
    latestAt: item.latestAt,
    bestTps: item.bestTps,
  })), [{
    key: "nvidia-nemotron",
    modelKey: "nvidia-nemotron",
    label: "Nemotron",
    records: 2,
    latestAt: "2026-08-02T10:00:00Z",
    bestTps: 55,
  }]);
});

test("benchmark presentation identifies MTP3 and preserves the latest model configuration", () => {
  const inferenceConfig = {
    precision: "NVFP4 / FP8 mixed",
    contextTokens: 65536,
    maxNumSeqs: 4,
    kvCache: "8 GB FP8",
    speculativeDecoding: { method: "MTP", draftTokens: 3 },
  };
  const history = [{
    model: "qwen3.8-27b-nvfp4",
    historyCategory: "coding",
    createdAt: "2026-08-15T12:00:00Z",
    parallel: 1,
    inferenceConfig,
    summary: { completed: 1, failed: 0, avgGenerationTokensPerSecond: 30 },
  }];

  assert.equal(speculativeDecodingLabel(inferenceConfig), "MTP3");
  assert.match(inferenceConfigLabel(inferenceConfig), /MTP3/);
  assert.deepEqual(summarizeBenchmarkModels(history)[0].latestInferenceConfig, inferenceConfig);
});
