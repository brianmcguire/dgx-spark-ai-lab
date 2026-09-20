// Only operator-configured PM2 services may be controlled. Never accept a shell
// command, PID, or arbitrary service name from an HTTP request.
export function validateSecondaryServices(services, primary) {
  if (!Array.isArray(services)) throw new Error('controller.secondaryServices must be an array.');
  const names = new Set([primary]);
  for (const service of services) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(service.serviceName || '') || names.has(service.serviceName)) {
      throw new Error('Secondary services need unique, safe PM2 service names.');
    }
    if (service.containerName && !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(service.containerName)) throw new Error('Invalid secondary container name.');
    if (service.conflictsWith && (!Array.isArray(service.conflictsWith) || service.conflictsWith.some(name => !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(name)))) throw new Error("conflictsWith must contain safe service names.");
    names.add(service.serviceName);
  }
  return services;
}

export function secondaryCommand(service, action) {
  validateSecondaryServices([service], '__primary__');
  if (!['start', 'stop'].includes(action)) throw new Error('Unsupported secondary service action.');
  const stopContainer = action === 'stop' && service.containerName
    ? `; if docker inspect '${service.containerName}' >/dev/null 2>&1; then docker stop -t 30 '${service.containerName}' >/dev/null; docker rm '${service.containerName}' >/dev/null 2>&1 || true; fi` : '';
  return `pm2 ${action} '${service.serviceName}'${stopContainer}; pm2 save`;
}

export function createModelServiceController({ inspect, primary, secondary, validateActivation, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 45 }) {
  let busy = false;
  async function drained(names, exclusive) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const state = await inspect();
      if (!state.ok || !state.runningModelsAvailable) throw new Error('Cannot verify released GPU memory. No new model was started.');
      const alive = state.runningModels.some(model => names.includes(model.serviceName));
      const online = state.modelServices.some(service => names.includes(service.serviceName) && service.status !== 'stopped');
      if (!alive && !online && (!exclusive || state.gpuProcessCount === 0)) return;
      await sleep(2000);
    }
    throw new Error('Model processes have not released the GPU. No new model was started. Refresh the dashboard before trying again.');
  }
  return {
    get busy() { return busy; },
    async run(input) {
      if (busy) throw new Error('A model control action is already in progress.');
      busy = true;
      try {
        const state = await inspect();
        if (!state.ok) throw new Error('Cannot inspect model services.');
        const services = state.modelServices || [];
        if (input.action === 'service-start' || input.action === 'service-stop') {
          const service = services.find(item => item.serviceName === input.serviceName);
          if (!service || service.status === 'missing') throw new Error('Select a configured, existing model service.');
          if (input.action === 'service-start' && service.startBlockedReason) throw new Error(service.startBlockedReason);
          if (input.action === 'service-start' && service.role !== 'primary' && state.primaryExclusive && state.service.pm2Status !== 'stopped') {
            throw new Error('Stop the exclusive primary model before starting a secondary model.');
          }
          const action = input.action === 'service-start' ? 'start' : 'stop';
          if (service.role === 'primary') await primary({ action });
          else await secondary(service.serviceName, action);
          if (action === 'stop') await drained([service.serviceName], false);
        } else if (input.action === 'stop-all' || input.action === 'activate-exclusive') {
          if (!state.runningModelsAvailable) throw new Error('Refresh host telemetry before stopping models.');
          const unknown = state.runningModels.filter(item => !services.some(service => service.serviceName === item.serviceName));
          if (unknown.length) throw new Error('An unmanaged model is running. Configure its service controls before using this action.');
          if (input.action === 'activate-exclusive') await validateActivation(input.modelKey, state);
          const online = services.filter(service => ['online', 'launching', 'waiting restart'].includes(service.status));
          const paused = [];
          try {
            for (const service of online.filter(item => item.role !== 'primary')) {
              await secondary(service.serviceName, 'stop');
              paused.push(service.serviceName);
            }
            await primary({ action: 'stop' });
            await drained(services.map(service => service.serviceName), input.action === 'activate-exclusive');
            if (input.action === 'activate-exclusive') await primary({ action: 'activate', modelKey: input.modelKey });
          } catch (error) {
            // A failed primary switch restores its launcher. Restore secondaries
            // only when fresh telemetry establishes that no exclusive model runs.
            const after = await inspect().catch(() => null);
            if (input.action === 'activate-exclusive' && after?.ok && after.runningModelsAvailable && !after.primaryExclusive) {
              for (const name of paused) {
                try { await secondary(name, 'start'); } catch { error.message += ` Could not restore ${name}; use its Start button.`; }
              }
            }
            throw error;
          }
        } else {
          await primary(input);
        }
        return await inspect();
      } finally { busy = false; }
    },
  };
}
