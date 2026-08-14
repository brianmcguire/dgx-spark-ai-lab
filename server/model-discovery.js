function humanize(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function repositoryFromCacheDirectory(cacheDirectory) {
  if (!String(cacheDirectory || "").startsWith("models--")) return null;
  const parts = cacheDirectory.slice("models--".length).split("--").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts.shift()}/${parts.join("--")}`;
}

export function buildDiscoveredModels(cacheDirectories, knownModels = []) {
  const knownDirectories = new Set(knownModels.map((model) => model.cacheDirectory).filter(Boolean));
  const repositories = new Set();
  const discovered = [];

  for (const cacheDirectory of cacheDirectories || []) {
    if (knownDirectories.has(cacheDirectory)) continue;
    const repository = repositoryFromCacheDirectory(cacheDirectory);
    if (!repository || repositories.has(repository)) continue;
    repositories.add(repository);
    const [provider, modelName] = repository.split("/");
    const slug = repository.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    discovered.push({
      key: `discovered-${slug}`,
      label: humanize(modelName),
      provider: humanize(provider),
      providerLogo: null,
      repository,
      cacheDirectory,
      precision: "Not configured",
      parameters: "Not configured",
      architecture: "Launch profile required",
      checkpointSize: "Downloaded",
      bestFor: "Review the model card before enabling",
      context: "Not configured",
      kvCache: "Not configured",
      description: "Downloaded checkpoint detected in the Hugging Face cache. Add a reviewed launch profile before using it.",
      modalities: "Not configured",
      servedNames: [],
      status: "discovered",
      installed: true,
      verified: false,
      active: false,
      loading: false,
      setupRequired: true,
    });
  }

  return discovered.sort((left, right) => left.repository.localeCompare(right.repository));
}

export function buildCatalogModels(knownModels = [], liveModels = []) {
  return knownModels.map((candidate) => {
    const activeModel = liveModels.find((model) => (
      model.configuredModelKey === candidate.key && !model.isApplicationAlias
    ));
    const state = activeModel
      ? "active"
      : candidate.status === "ready"
        ? "ready"
        : candidate.status === "staged"
          ? "staged"
          : "unavailable";
    const id = activeModel?.id || candidate.servedNames?.at(-1) || candidate.key;

    return {
      key: candidate.key,
      id,
      servedNames: candidate.servedNames || [],
      displayName: candidate.label,
      provider: candidate.provider || null,
      providerLogo: candidate.providerLogo || null,
      label: `${candidate.label} - ${state === "active" ? "Active" : state === "ready" ? "Ready" : state === "staged" ? "Staged" : "Unavailable"}`,
      state,
      selectable: state === "active",
      modalities: candidate.modalities || "Text",
      visualCapable: /\b(?:image|video)\b/i.test(candidate.modalities || "Text"),
      description: candidate.description,
    };
  });
}
