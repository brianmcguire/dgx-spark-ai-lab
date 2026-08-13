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
