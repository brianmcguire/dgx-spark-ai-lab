import test from 'node:test';
import assert from 'node:assert/strict';
import { activationBlockReason, assertModelActivationAllowed } from '../server/model-eligibility.js';
import { partitionModels } from '../src/model-archive.js';

test('archive profiles cannot activate even after download completes', () => {
  for (const installed of [false, true]) {
    const model = { archiveOnly: true, installed, activationBlockedReason: 'Requires 2 DGX Sparks' };
    assert.throws(() => assertModelActivationAllowed(model), /Requires 2 DGX Sparks/);
  }
  assert.throws(() => assertModelActivationAllowed({ archiveOnly: true }), /Archived for future hardware/);
  assert.doesNotThrow(() => assertModelActivationAllowed({ installed: true }));
  assert.equal(activationBlockReason({}), null);
});

test('stored and downloading archive profiles remain visible in the main catalog', () => {
  for (const status of ['downloading', 'verifying', 'archived on disk', 'failed']) {
    const model = { archiveOnly: true, status, installed: status === 'archived on disk' };
    assert.deepEqual(partitionModels([model]).available, [model]);
  }
});
