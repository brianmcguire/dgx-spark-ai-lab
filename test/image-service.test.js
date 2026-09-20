import test from 'node:test';
import assert from 'node:assert/strict';
import { imageServiceRoute } from '../server/image-service.js';
test('image proxy permits only fixed endpoints and validated output IDs', () => {
  assert.equal(imageServiceRoute('/api/images/jobs','POST'),'/jobs');
  assert.equal(imageServiceRoute('/api/images/health','GET'),'/health');
  assert.equal(imageServiceRoute('/api/images/images/'+'a'.repeat(32),'GET'),'/images/'+'a'.repeat(32));
  for (const path of ['/api/images/images/../../etc/passwd','/api/images/http://other','/api/images/jobs/not-a-job']) assert.throws(()=>imageServiceRoute(path,'GET'));
  assert.throws(()=>imageServiceRoute('/api/images/health','POST'));
});
