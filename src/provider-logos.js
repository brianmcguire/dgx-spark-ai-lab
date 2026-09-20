export const PROVIDER_LOGO_PATHS = Object.freeze({
  nvidia: "/provider-logos/nvidia.svg",
  google: "/provider-logos/google.png",
  qwen: "/provider-logos/qwen.webp",
  "red-hat": "/provider-logos/red-hat.svg",
  poolside: "/provider-logos/poolside.svg",
});

// Community quantizers inherit the base model's mark when they do not supply
// a supported logo. An explicit logo always wins; NVFP4 alone is not NVIDIA branding.
export function resolveModelLogo(model = {}) {
  if (Object.hasOwn(PROVIDER_LOGO_PATHS, model.providerLogo)) return model.providerLogo;
  const identity = [model.repository, model.displayName, model.label, model.modelLabel, model.id, model.key, model.modelKey, model.model].filter(Boolean).join(' ').toLowerCase();
  if (/qwen/.test(identity)) return 'qwen';
  if (/nemotron/.test(identity)) return 'nvidia';
  if (/gemma|gemini/.test(identity)) return 'google';
  if (/laguna|poolside/.test(identity)) return 'poolside';
  const provider = String(model.provider || '').toLowerCase().trim();
  if (Object.hasOwn(PROVIDER_LOGO_PATHS, provider)) return provider;
  return null;
}
