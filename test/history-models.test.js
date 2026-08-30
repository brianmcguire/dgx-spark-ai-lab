import test from "node:test";
import assert from "node:assert/strict";
import { modelPresentationSnapshot, normalizeHistoryModel, normalizeHistoryModels } from "../server/history-models.js";

test("history-only metadata excludes controller and checkpoint fields", () => {
  const historyModel = normalizeHistoryModel({
    key: "retired-model",
    id: "retired-model-served",
    label: "Retired Model",
    provider: "Example",
    providerLogo: "example",
    servedNames: ["application-alias", "retired-model-served"],
    repository: "example/private-recipe",
    cacheDirectory: "models--example--private-recipe",
    launchArgs: "--trust-remote-code",
    readyMarker: "/tmp/retired.ready",
  });

  assert.deepEqual(historyModel, {
    key: "retired-model",
    id: "retired-model-served",
    servedNames: ["application-alias", "retired-model-served"],
    displayName: "Retired Model",
    provider: "Example",
    providerLogo: "example",
  });
  assert.equal("repository" in historyModel, false);
  assert.equal("cacheDirectory" in historyModel, false);
  assert.equal("launchArgs" in historyModel, false);
  assert.equal("readyMarker" in historyModel, false);
});

test("model presentation snapshots are safe and deduplicated by key", () => {
  const snapshot = modelPresentationSnapshot({
    key: "model-a",
    id: "model-a-served",
    label: "Model A",
    providerLogo: "nvidia",
    dockerArgs: "--secret-runtime-setting",
  });
  const models = normalizeHistoryModels([snapshot, { ...snapshot, displayName: "Model A Updated" }]);

  assert.equal(models.length, 1);
  assert.equal(models[0].displayName, "Model A Updated");
  assert.equal("dockerArgs" in models[0], false);
});
