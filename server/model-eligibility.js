// Archive-only profiles deliberately have no executable launch configuration.
export function activationBlockReason(model) {
  if (!model?.archiveOnly) return null;
  return model.activationBlockedReason || 'Archived for future hardware. Configure and validate a compatible runtime before enabling this model.';
}

export function assertModelActivationAllowed(model) {
  const reason = activationBlockReason(model);
  if (reason) throw new Error(reason);
}
