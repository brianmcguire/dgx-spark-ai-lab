import test from "node:test";
import assert from "node:assert/strict";
import { initialCodingBenchmarkView } from "../src/benchmark-history.js";

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
