import test from "node:test";
import assert from "node:assert/strict";
import { redactSensitiveData, redactSensitiveString } from "../server/redaction.js";

test("redacts secrets embedded in diagnostic command lines", () => {
  const output = redactSensitiveString(
    "vllm serve model --api-key abc123 --token=def456 AUTH_TOKEN=ghi789 Authorization: Bearer jkl012",
  );

  assert.equal(output.includes("abc123"), false);
  assert.equal(output.includes("def456"), false);
  assert.equal(output.includes("ghi789"), false);
  assert.equal(output.includes("jkl012"), false);
  assert.match(output, /--api-key \[REDACTED\]/);
});

test("recursively redacts sensitive keys while retaining diagnostic structure", () => {
  const input = {
    anonymized: true,
    processes: [{ args: "python app.py --password hunter2", cpu_percent: 12 }],
    dgx: { processes: [{ args: "vllm serve model --api-key live-key-value" }] },
    network: { authorization: "Bearer secret-value", endpoint: "https://user:pass@example.test/v1" },
  };

  assert.deepEqual(redactSensitiveData(input), {
    anonymized: true,
    processes: [{ args: "python app.py --password [REDACTED]", cpu_percent: 12 }],
    dgx: { processes: [{ args: "vllm serve model --api-key [REDACTED]" }] },
    network: { authorization: "[REDACTED]", endpoint: "https://user:[REDACTED]@example.test/v1" },
  });
});
