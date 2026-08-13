import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveredModels, repositoryFromCacheDirectory } from "../server/model-discovery.js";

test("converts Hugging Face cache directories into repositories", () => {
  assert.equal(repositoryFromCacheDirectory("models--nvidia--Example-Model"), "nvidia/Example-Model");
  assert.equal(repositoryFromCacheDirectory("datasets--nvidia--Example-Model"), null);
});

test("unknown downloaded models require an explicit launch profile", () => {
  const models = buildDiscoveredModels([
    "models--nvidia--Known",
    "models--organization--New-Model",
  ], [{ cacheDirectory: "models--nvidia--Known" }]);

  assert.equal(models.length, 1);
  assert.equal(models[0].repository, "organization/New-Model");
  assert.equal(models[0].status, "discovered");
  assert.equal(models[0].setupRequired, true);
  assert.deepEqual(models[0].servedNames, []);
});
