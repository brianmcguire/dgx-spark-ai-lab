export function hasCompleteSuite(history, suiteId, suite) {
  if (!suiteId || !suite?.cases?.length) return false;
  const expectedCases = new Set(suite.cases.map(({ id }) => id));
  const runs = new Map();

  for (const entry of history || []) {
    if (entry.historyCategory !== "coding" || entry.suiteId !== suiteId || !entry.suiteRunId) continue;
    const run = runs.get(entry.suiteRunId) || new Map();
    run.set(entry.suiteCaseId, entry);
    runs.set(entry.suiteRunId, run);
  }

  return [...runs.values()].some((run) => [...expectedCases].every((caseId) => {
    const entry = run.get(caseId);
    return entry && entry.summary?.failed === 0 && entry.summary?.completed === entry.parallel;
  }));
}

export function latestSingleCodingView(history) {
  const latestCompatible = (history || []).find((entry) => (
    entry.historyCategory === "coding"
    && !entry.suiteId
    && entry.profile
    && Number(entry.maxTokens) > 0
    && Number(entry.parallel) > 0
  ));
  if (!latestCompatible) return null;

  return {
    benchmarkPlan: "single",
    profile: latestCompatible.profile,
    maxTokens: Number(latestCompatible.maxTokens),
    parallel: Number(latestCompatible.parallel),
  };
}

export function bestComparableSingleCodingView(history, catalogModels = []) {
  const groups = new Map();
  const presentation = catalogModelPresentations(catalogModels);

  for (const entry of history || []) {
    const completed = Number(entry.summary?.completed || 0);
    const failed = Number(entry.summary?.failed || 0);
    const tps = Number(entry.summary?.avgGenerationTokensPerSecond);
    if (entry.historyCategory !== "coding" || entry.suiteId || !entry.profile
      || Number(entry.maxTokens) <= 0 || Number(entry.parallel) <= 0
      || !entry.model || completed <= 0 || failed > 0 || !Number.isFinite(tps) || tps <= 0) continue;

    const key = `${entry.profile}:${Number(entry.maxTokens)}:${Number(entry.parallel)}`;
    const current = groups.get(key) || {
      profile: entry.profile,
      maxTokens: Number(entry.maxTokens),
      parallel: Number(entry.parallel),
      models: new Set(),
      records: 0,
      latestAt: 0,
    };
    const metadata = presentation.get(entry.modelKey) || presentation.get(entry.model);
    current.models.add(metadata?.key || entry.modelKey || entry.model);
    current.records += 1;
    current.latestAt = Math.max(current.latestAt, new Date(entry.createdAt || entry.timestamp || 0).getTime() || 0);
    groups.set(key, current);
  }

  const best = [...groups.values()].sort((left, right) => (
    right.models.size - left.models.size
    || right.records - left.records
    || right.latestAt - left.latestAt
  ))[0];
  if (!best) return latestSingleCodingView(history);

  return {
    benchmarkPlan: "single",
    profile: best.profile,
    maxTokens: best.maxTokens,
    parallel: best.parallel,
  };
}

export function catalogModelPresentations(catalogModels = []) {
  const entries = [];
  for (const model of catalogModels || []) {
    for (const identity of [model.key, model.id, ...(model.servedNames || [])]) {
      if (identity) entries.push([identity, model]);
    }
  }
  return new Map(entries);
}

export function speculativeDecodingLabel(config, fallback = "Not recorded") {
  const speculative = config?.speculativeDecoding;
  if (!speculative?.method || !Number.isFinite(Number(speculative.draftTokens))) return fallback;
  return `${String(speculative.method).toUpperCase()}${Number(speculative.draftTokens)}`;
}

export function inferenceConfigLabel(config, fallback = "Configuration not recorded") {
  if (!config) return fallback;
  const parts = [
    config.precision,
    Number(config.contextTokens) > 0 ? `${Number(config.contextTokens).toLocaleString()} context` : null,
    config.kvCache ? `${config.kvCache} KV cache` : null,
    Number(config.maxNumSeqs) > 0 ? `${Number(config.maxNumSeqs)} max streams` : null,
    speculativeDecodingLabel(config, null),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : fallback;
}

export function summarizeBenchmarkModels(history, benchmarkType = "coding", catalogModels = []) {
  const grouped = new Map();
  const presentation = catalogModelPresentations(catalogModels);

  for (const entry of history || []) {
    const category = entry.historyCategory || entry.benchmarkType || "coding";
    if (category !== benchmarkType || !entry.model) continue;

    const metadata = presentation.get(entry.modelKey) || presentation.get(entry.model);
    const key = metadata?.key || entry.modelKey || entry.model;
    const current = grouped.get(key) || {
      key,
      model: entry.model,
      modelKey: entry.modelKey || metadata?.key || null,
      modelLabel: entry.modelLabel || metadata?.displayName || metadata?.label || null,
      records: 0,
      completed: 0,
      failed: 0,
      configurations: new Set(),
      suiteRuns: new Set(),
      latestAt: null,
      latestInferenceConfig: null,
      bestTps: null,
    };
    const completed = Number(entry.summary?.completed || 0);
    const failed = Number(entry.summary?.failed || 0);
    const tps = Number(entry.summary?.avgGenerationTokensPerSecond);
    const createdAt = entry.createdAt || entry.timestamp || null;

    current.records += 1;
    if (completed > 0) current.completed += 1;
    if (failed > 0 || completed !== Number(entry.parallel || 1)) current.failed += 1;
    current.configurations.add(entry.suiteId || `${entry.profile || "unknown"}:${entry.maxTokens || 0}:${entry.parallel || 1}`);
    if (entry.suiteRunId) current.suiteRuns.add(entry.suiteRunId);
    if (createdAt && (!current.latestAt || new Date(createdAt) > new Date(current.latestAt))) {
      current.latestAt = createdAt;
      current.latestInferenceConfig = entry.inferenceConfig || null;
    }
    if (Number.isFinite(tps) && tps > 0 && (!Number.isFinite(current.bestTps) || tps > current.bestTps)) current.bestTps = tps;
    if (entry.modelKey) current.modelKey = entry.modelKey;
    if (entry.modelLabel) current.modelLabel = entry.modelLabel;
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((item) => ({
      ...item,
      configurations: item.configurations.size,
      suiteRuns: item.suiteRuns.size,
    }))
    .sort((left, right) => {
      const timeDifference = new Date(right.latestAt || 0) - new Date(left.latestAt || 0);
      return timeDifference || left.model.localeCompare(right.model);
    });
}

export function initialCodingBenchmarkView(history, codingSuites, defaultSuiteId = "standardCodingV1", catalogModels = []) {
  if (hasCompleteSuite(history, defaultSuiteId, codingSuites?.[defaultSuiteId])) {
    return { benchmarkPlan: defaultSuiteId };
  }

  return bestComparableSingleCodingView(history, catalogModels) || { benchmarkPlan: defaultSuiteId };
}
