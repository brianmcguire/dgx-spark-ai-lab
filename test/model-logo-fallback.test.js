import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelLogo } from '../src/provider-logos.js';
import { modelPresentationSnapshot } from '../server/history-models.js';

test('community checkpoints and historical labels use their base model logo', () => {
  assert.equal(resolveModelLogo({ repository: 'Mia-AiLab/Qwen3.8-Flash-Next-NVFP4', provider: 'Mia AI Lab' }), 'qwen');
  assert.equal(resolveModelLogo({ modelLabel: 'Qwen 3.8 Flash Next NVFP4 · Mia' }), 'qwen');
  assert.equal(resolveModelLogo({ providerLogo: 'mia', id: 'mia-qwen3.8-flash-next-nvfp4' }), 'qwen');
  assert.equal(resolveModelLogo({ repository: 'community/Nemotron-quant' }), 'nvidia');
  assert.equal(resolveModelLogo({ repository: 'community/gemma-quant' }), 'google');
  assert.equal(resolveModelLogo({ label: 'Laguna XS' }), 'poolside');
});

test('explicit branding wins and quantization does not imply a provider', () => {
  assert.equal(resolveModelLogo({ providerLogo: 'nvidia', label: 'Qwen 27B' }), 'nvidia');
  assert.equal(resolveModelLogo({ label: 'Unknown NVFP4', provider: 'Mia AI Lab' }), null);
});

test('new benchmark snapshots retain the resolved base-model logo', () => {
  assert.equal(modelPresentationSnapshot({ key: 'mia-flash', label: 'Qwen Flash Next · Mia' }).providerLogo, 'qwen');
});
