export function partitionModels(models = [], runningModels = []) {
  const running = new Set(runningModels.map((model) => model.repository));
  const archived = [];
  const available = [];
  for (const model of models) {
    const missing = model.status === 'unavailable' && !model.installed;
    (missing && !model.active && !model.loading && !running.has(model.repository) ? archived : available).push(model);
  }
  return { available, archived };
}
