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

export function summarizeBenchmarkModels(history, benchmarkType = "coding") {
  const grouped = new Map();

  for (const entry of history || []) {
    const category = entry.historyCategory || entry.benchmarkType || "coding";
    if (category !== benchmarkType || !entry.model) continue;

    const key = entry.modelKey || entry.model;
    const current = grouped.get(key) || {
      key,
      model: entry.model,
      modelKey: entry.modelKey || null,
      modelLabel: entry.modelLabel || null,
      records: 0,
      completed: 0,
      failed: 0,
      configurations: new Set(),
      suiteRuns: new Set(),
      latestAt: null,
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
    if (createdAt && (!current.latestAt || new Date(createdAt) > new Date(current.latestAt))) current.latestAt = createdAt;
    if (Number.isFinite(tps) && tps > 0 && (!Number.isFinite(current.bestTps) || tps > current.bestTps)) current.bestTps = tps;
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

export function initialCodingBenchmarkView(history, codingSuites, defaultSuiteId = "standardCodingV1") {
  if (hasCompleteSuite(history, defaultSuiteId, codingSuites?.[defaultSuiteId])) {
    return { benchmarkPlan: defaultSuiteId };
  }

  return latestSingleCodingView(history) || { benchmarkPlan: defaultSuiteId };
}
