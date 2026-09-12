import test from "node:test";
import assert from "node:assert/strict";
import { CHART_COLORS } from "../src/chart-palette.js";

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test("chart accents remain distinct and legible against the dark plotting surface", () => {
  assert.equal(new Set(Object.values(CHART_COLORS)).size, 6);
  for (const [name, color] of Object.entries(CHART_COLORS)) {
    assert.match(color, /^#[a-f0-9]{6}$/i);
    const contrast = (luminance(color) + 0.05) / (luminance("#07131c") + 0.05);
    assert(contrast >= 4.5, `${name} must stay readable for chart labels and traces`);
  }
});
