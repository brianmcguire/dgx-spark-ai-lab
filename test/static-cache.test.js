import test from "node:test";
import assert from "node:assert/strict";
import { staticResponseHeaders } from "../server/static-cache.js";

test("HTML app shell is never reused across deployments", () => {
  assert.deepEqual(staticResponseHeaders("/index.html", "text/html; charset=utf-8"), {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache, no-store, must-revalidate",
    pragma: "no-cache",
    expires: "0",
  });
  assert.equal(staticResponseHeaders("/latency", "text/html; charset=utf-8", { fallback: true })["cache-control"], "no-cache, no-store, must-revalidate");
});
test("fingerprinted bundles are immutable while ordinary assets expire", () => {
  assert.equal(
    staticResponseHeaders("/assets/index-DMc6NanJ.js", "text/javascript; charset=utf-8")["cache-control"],
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    staticResponseHeaders("/dgx-spark-icon.png", "image/png")["cache-control"],
    "public, max-age=3600",
  );
});
