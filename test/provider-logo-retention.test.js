import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PROVIDER_LOGO_PATHS } from "../src/provider-logos.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("provider logo manifest pins every dashboard logo asset", async () => {
  const manifest = JSON.parse(await readFile(`${ROOT}/public/provider-logos/manifest.json`, "utf8"));
  assert.deepEqual(Object.keys(manifest.logos).sort(), Object.keys(PROVIDER_LOGO_PATHS).sort());

  for (const [key, publicPath] of Object.entries(PROVIDER_LOGO_PATHS)) {
    const entry = manifest.logos[key];
    assert.equal(entry.path, publicPath);
    const content = await readFile(`${ROOT}/public${publicPath}`);
    assert.equal(createHash("sha256").update(content).digest("hex"), entry.sha256);
  }
});
