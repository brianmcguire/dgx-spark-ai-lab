import test from "node:test";
import assert from "node:assert/strict";
import { doctorScanSummary } from "../src/doctor-status.js";

test("an incomplete scan is not shown as clean when no findings were produced", () => {
  const summary = doctorScanSummary({ findings: [], collector_statuses: [{ name: "gpu", ok: false }] });
  assert.equal(summary.incomplete, true);
  assert.equal(summary.ok, false);
  assert.equal(summary.clean, false);
  assert.equal(summary.label, "Incomplete");
});

test("a completed scan without findings is clean", () => {
  const summary = doctorScanSummary({ findings: [], collector_statuses: [{ name: "gpu", ok: true }] }, 0);
  assert.equal(summary.clean, true);
  assert.equal(summary.label, "Clean");
});

test("informational findings do not make the dashboard unhealthy", () => {
  const summary = doctorScanSummary({ findings: [{ severity: "info", title: "Host Python is CPU-only" }], collector_statuses: [] }, 0);
  assert.equal(summary.ok, true);
  assert.equal(summary.clean, false);
  assert.equal(summary.label, "1 info");
});
