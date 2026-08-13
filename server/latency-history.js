const VISUAL_PROFILES = new Set(["extraction", "reasoning", "document", "comparison"]);

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
    historyVersion: 2,
    legacy: record.historyVersion !== 2,
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
