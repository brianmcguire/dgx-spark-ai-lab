import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagedLaunchScript, assertExclusiveModelAvailable } from '../server/managed-launcher.js';

test('managed launchers reject shell expressions and relative paths', () => {
  for (const path of ['relative.sh', '/tmp/a;id', '/tmp/$(id)', '/tmp/../a', '/tmp/a\nb']) {
    assert.throws(() => createManagedLaunchScript({}, path));
  }
  assert.match(createManagedLaunchScript({ repository: 'org/model' }, '/opt/model/serve.sh'), /exec '\/opt\/model\/serve.sh'/);
});

test('exclusive model refuses secondary processes and unavailable telemetry before replacement', () => {
  const model = { exclusiveHost: true };
  assert.throws(() => assertExclusiveModelAvailable(model, {}), /Cannot verify/);
  assert.throws(() => assertExclusiveModelAvailable(model, { runningModelsAvailable: true, runningModels: [{ role: 'secondary', serviceName: 'sentinel' }] }), /sentinel/);
  assert.doesNotThrow(() => assertExclusiveModelAvailable(model, { runningModelsAvailable: true, runningModels: [{ role: 'primary' }] }));
  assert.doesNotThrow(() => assertExclusiveModelAvailable({}, {}));
});
