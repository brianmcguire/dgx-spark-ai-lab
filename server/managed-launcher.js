// Trusted operator catalog entries can use a locally installed serving recipe.
// The recipe must keep the configured primary container in the foreground and
// stop it on SIGTERM so normal controller rollback remains effective.
export function createManagedLaunchScript(model, launcher) {
  if (!/^\/[A-Za-z0-9_./-]+$/.test(launcher || '') || launcher.split('/').includes('..')) {
    throw new Error('Managed launcher must be an absolute path without shell syntax.');
  }
  const repository = String(model.repository || '').replace(/[\r\n]/g, ' ');
  return `#!/usr/bin/env bash\nset -euo pipefail\n# Model: ${repository}\nexec '${launcher}'\n`;
}

export function assertExclusiveModelAvailable(model, state) {
  if (!model?.exclusiveHost) return;
  if (!state.runningModelsAvailable) throw new Error('Cannot verify other running models. Refresh host telemetry before loading this model.');
  const secondary = (state.runningModels || []).filter(item => item.role !== 'primary');
  if (secondary.length) throw new Error(`This model needs exclusive Spark memory. Stop the secondary model services first: ${secondary.map(item => item.serviceName || item.label || item.repository).join(', ')}.`);
}
