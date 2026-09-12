import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionModels } from '../src/model-archive.js';
test('only missing inactive checkpoints enter the archive', () => {
  const missing = { repository: 'nvidia/old', status: 'unavailable', installed: false };
  const installed = { status: 'staged', installed: true };
  assert.deepEqual(partitionModels([missing, installed]), { archived: [missing], available: [installed] });
  for (const state of [{ active: true }, { loading: true }]) {
    assert.equal(partitionModels([{ ...missing, ...state }]).archived.length, 0);
  }
  assert.equal(partitionModels([missing], [missing]).archived.length, 0);
  assert.deepEqual(partitionModels(), { available: [], archived: [] });
});
