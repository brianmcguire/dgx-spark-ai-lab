import { normalizeHistoryModel } from "./history-models.js";

const VISUAL_PROFILES = new Set(["extraction", "reasoning", "document", "comparison"]);

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeInferenceConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const speculative = config.speculativeDecoding && typeof config.speculativeDecoding === "object"
    ? {
      method: typeof config.speculativeDecoding.method === "string" ? config.speculativeDecoding.method : null,
      draftTokens: finiteNumber(config.speculativeDecoding.draftTokens),
    }
    : null;
  return {
    precision: typeof config.precision === "string" ? config.precision : null,
    contextTokens: finiteNumber(config.contextTokens),
    maxNumSeqs: finiteNumber(config.maxNumSeqs),
    kvCache: typeof config.kvCache === "string" ? config.kvCache : null,
    speculativeDecoding: speculative?.method && speculative?.draftTokens > 0 ? speculative : null,
  };
}

export function normalizeLatencyRecord(record, { modelAliases = new Map() } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;

  const originalModel = typeof record.model === "string" ? record.model : "";
  const model = modelAliases.get(originalModel) || originalModel;
  const inferredVisual = record.benchmarkType === "visual"
    || (!record.benchmarkType && VISUAL_PROFILES.has(record.profile));
  const benchmarkType = inferredVisual ? "visual" : "coding";
  const suiteId = benchmarkType === "coding" && typeof record.suiteId === "string" && record.suiteId
    ? record.suiteId
    : null;

  return {
    ...record,
    model,
    benchmarkType,
    historyCategory: benchmarkType,
    historyVersion: 4,
    legacy: ![2, 3, 4].includes(record.historyVersion),
    modelPresentation: normalizeHistoryModel(record.modelPresentation),
    inferenceConfig: normalizeInferenceConfig(record.inferenceConfig),
    suiteId,
    suiteRunId: suiteId && typeof record.suiteRunId === "string" ? record.suiteRunId : null,
    suiteCaseId: suiteId && typeof record.suiteCaseId === "string" ? record.suiteCaseId : null,
    maxTokens: finiteNumber(record.maxTokens, 0),
    parallel: Math.max(1, finiteNumber(record.parallel, 1)),
    summary: record.summary && typeof record.summary === "object" ? record.summary : {},
    runs: Array.isArray(record.runs) ? record.runs : [],
  };
}

export function normalizeLatencyHistory(records, options = {}) {
  if (!Array.isArray(records)) return [];
  const seen = new Set();
  return records
    .map((record) => normalizeLatencyRecord(record, options))
    .filter((record) => {
      if (!record) return false;
      const key = record.id || `${record.createdAt || ""}:${record.model}:${record.profile || ""}:${record.suiteCaseId || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
