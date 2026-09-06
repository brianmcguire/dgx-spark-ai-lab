import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("the final Spark artwork is bundled and matches the component reference", async () => {
  const component = await readFile(new URL("../src/SparkFlow.jsx", import.meta.url), "utf8");
  const artwork = await readFile(new URL("../public/dgx-spark-flow-v4.png", import.meta.url));
  assert.match(component, /href="\/dgx-spark-flow-v4\.png"/);
  assert.equal(artwork.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(createHash("sha256").update(artwork).digest("hex"),
    "6ffeb94c57911541d2310d953ee7044c22f9c4e63e58283e6c0255e8cd6014c7");
});
