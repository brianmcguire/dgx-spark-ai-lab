function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeHistoryModel(model = {}) {
  if (!model || typeof model !== "object" || Array.isArray(model)) return null;

  const key = cleanString(model.key || model.modelKey);
  if (!key) return null;

  const servedNames = Array.isArray(model.servedNames)
    ? [...new Set(model.servedNames.map(cleanString).filter(Boolean))]
    : [];
  const id = cleanString(model.id) || servedNames.at(-1) || key;

  return {
    key,
    id,
    servedNames,
    displayName: cleanString(model.displayName || model.label || model.modelLabel) || id,
    provider: cleanString(model.provider),
    providerLogo: cleanString(model.providerLogo),
  };
}

export function normalizeHistoryModels(models = []) {
  if (!Array.isArray(models)) return [];
  const byKey = new Map();
  for (const model of models) {
    const normalized = normalizeHistoryModel(model);
    if (normalized) byKey.set(normalized.key, normalized);
  }
  return [...byKey.values()];
}

export function modelPresentationSnapshot(model = {}) {
  return normalizeHistoryModel(model);
}
