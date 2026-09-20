import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelServiceController, secondaryCommand, validateSecondaryServices } from '../server/model-service-controls.js';

function fixture(overrides = {}) {
  const state = { ok: true, runningModelsAvailable: true, gpuProcessCount: 2, primaryExclusive: false, service: { pm2Status: 'online' }, modelServices: [
    { serviceName: 'primary', role: 'primary', status: 'online' },
    { serviceName: 'sentinel', role: 'secondary', status: 'online' },
  ], runningModels: [{ serviceName: 'primary' }, { serviceName: 'sentinel' }] };
  const calls = [];
  const change = (name, action) => {
    state.modelServices.find(item => item.serviceName === name).status = action === 'stop' ? 'stopped' : 'online';
    state.runningModels = state.runningModels.filter(item => item.serviceName !== name);
    if (action !== 'stop') state.runningModels.push({ serviceName: name });
    state.gpuProcessCount = state.runningModels.length;
    state.service.pm2Status = state.modelServices[0].status;
  };
  const controller = createModelServiceController({
    inspect: async () => structuredClone(state),
    primary: async input => { calls.push(['primary', input.action]); change('primary', input.action); },
    secondary: async (name, action) => { calls.push([name, action]); change(name, action); },
    validateActivation: async () => calls.push(['validate']),
    sleep: async () => {}, attempts: 2,
    ...overrides,
  });
  return { state, calls, controller };
}

test('exclusive activation validates before stopping, waits for GPU release, then activates', async () => {
  const { controller, calls } = fixture();
  await controller.run({ action: 'activate-exclusive', modelKey: 'mia' });
  assert.deepEqual(calls, [['validate'], ['sentinel', 'stop'], ['primary', 'stop'], ['primary', 'activate']]);
});

test('stop all stops both services without activating another model', async () => {
  const { controller, state } = fixture();
  await controller.run({ action: 'stop-all' });
  assert.equal(state.runningModels.length, 0);
  await controller.run({ action: 'service-start', serviceName: 'sentinel' });
  assert.equal(state.modelServices[1].status, 'online');
});

test('unconfigured service names cannot execute a command', async () => {
  const { controller, calls } = fixture();
  await assert.rejects(controller.run({ action: 'service-stop', serviceName: 'other; reboot' }), /configured/);
  assert.deepEqual(calls, []);
});

test('missing telemetry and unmanaged models fail before stopping anything', async () => {
  for (const mutate of [state => state.runningModelsAvailable = false, state => state.runningModels.push({ serviceName: 'unknown' })]) {
    const { controller, calls, state } = fixture(); mutate(state);
    await assert.rejects(controller.run({ action: 'activate-exclusive' }));
    assert.deepEqual(calls, []);
  }
});

test('invalid activation fails before services are stopped', async () => {
  const { controller, calls } = fixture({ validateActivation: async () => { throw new Error('Not installed'); } });
  await assert.rejects(controller.run({ action: 'activate-exclusive' }), /Not installed/);
  assert.deepEqual(calls, []);
});

test('secondary cannot start while exclusive primary is running or starting', async () => {
  const { controller, calls, state } = fixture(); state.primaryExclusive = true;
  await assert.rejects(controller.run({ action: 'service-start', serviceName: 'sentinel' }), /exclusive/);
  assert.deepEqual(calls, []);
});

test('GPU processes lingering after PM2 stop prevent activation', async () => {
  const { controller, calls, state } = fixture({ secondary: async () => {}, primary: async input => { calls.push(input.action); } });
  await assert.rejects(controller.run({ action: 'activate-exclusive' }), /released the GPU/);
  assert.ok(!calls.includes('activate'));
});

test('failed candidate restores only previously running secondaries after safe primary rollback', async () => {
  let fixtureValue;
  fixtureValue = fixture({ primary: async input => {
    if (input.action === 'activate') throw new Error('Candidate failed; primary rolled back');
    fixtureValue.state.modelServices[0].status = 'stopped';
    fixtureValue.state.runningModels = [];
    fixtureValue.state.gpuProcessCount = 0;
  } });
  await assert.rejects(fixtureValue.controller.run({ action: 'activate-exclusive' }), /Candidate failed/);
  assert.deepEqual(fixtureValue.calls, [['validate'], ['sentinel', 'stop'], ['sentinel', 'start']]);
});

test('control lock covers initial inspection and is released on failure', async () => {
  let release;
  const controller = createModelServiceController({ inspect: () => new Promise(resolve => { release = resolve; }) });
  const first = controller.run({ action: 'stop-all' });
  await assert.rejects(controller.run({ action: 'stop-all' }), /already in progress/);
  release({ ok: false });
  await assert.rejects(first, /inspect/);
  assert.equal(controller.busy, false);
});

test('configuration rejects injection, duplicate names, and invalid containers', () => {
  for (const serviceName of ['bad;cmd', '-all', 'primary']) assert.throws(() => validateSecondaryServices([{ serviceName }], 'primary'));
  assert.throws(() => secondaryCommand({ serviceName: 'sentinel', containerName: 'x;rm' }, 'stop'));
  assert.throws(() => secondaryCommand({ serviceName: 'sentinel' }, 'delete'));
  assert.equal(secondaryCommand({ serviceName: 'sentinel' }, 'stop'), "pm2 stop 'sentinel'; pm2 save");
});
