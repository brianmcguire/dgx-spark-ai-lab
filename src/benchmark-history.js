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

export function initialCodingBenchmarkView(history, codingSuites, defaultSuiteId = "standardCodingV1") {
  if (hasCompleteSuite(history, defaultSuiteId, codingSuites?.[defaultSuiteId])) {
    return { benchmarkPlan: defaultSuiteId };
  }

  const latestCompatible = (history || []).find((entry) => (
    entry.historyCategory === "coding"
    && !entry.suiteId
    && entry.profile
    && Number(entry.maxTokens) > 0
    && Number(entry.parallel) > 0
  ));
  if (!latestCompatible) return { benchmarkPlan: defaultSuiteId };

  return {
    benchmarkPlan: "single",
    profile: latestCompatible.profile,
    maxTokens: Number(latestCompatible.maxTokens),
    parallel: Number(latestCompatible.parallel),
  };
}
