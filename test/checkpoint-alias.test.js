import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogModelPresentations} from '../src/benchmark-history.js';

test('shared compatibility aliases retain historical canonical checkpoint names', () => {
  const old = {key:'unsloth', servedNames:['production','qwen-nvfp4']};
  const next = {key:'nvidia', servedNames:['production','qwen-nvfp4','nvidia-qwen-nvfp4']};
  for (const models of [[old,next],[next,old]]) {
    const lookup = catalogModelPresentations(models);
    assert.equal(lookup.get('qwen-nvfp4').key, 'unsloth');
    assert.equal(lookup.get('nvidia-qwen-nvfp4').key, 'nvidia');
  }
});
