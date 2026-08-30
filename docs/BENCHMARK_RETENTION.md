# Benchmark and icon retention

Model checkpoints, benchmark records, and provider logos have separate lifecycles. Removing a checkpoint from the Hugging Face cache must not remove its performance history or dashboard identity.

## What the dashboard retains

- Benchmark runs remain in `.data/latency-runs.json`. Model-controller cleanup does not write to this file.
- New benchmark records include a safe `modelPresentation` snapshot with the model key, display name, served names, provider, and provider-logo key.
- Provider logos remain in `public/provider-logos/`. The manifest in that directory pins every bundled asset by SHA-256 checksum.
- `historyModels` supplies display metadata for older benchmark records created before presentation snapshots were added.

Runtime details such as repositories, cache directories, launch arguments, markers, container images, and local paths are excluded from saved presentation metadata.

## Remove a checkpoint without losing history

1. Back up `.data/latency-runs.json` before deleting files.
2. Stop the model and remove its checkpoint from the compute host.
3. Remove its launch recipe from `models` in `config/models.local.json` if it should no longer appear in Model Controller.
4. For older records, copy only the model's display fields into `historyModels` in the same local file.
5. Keep the referenced logo in `public/provider-logos/` and its entry in `manifest.json`.
6. Run `npm run check`, restart the dashboard, and confirm the model remains in Saved model history but is absent from Model Controller.

Example:

```json
{
  "historyModels": [
    {
      "key": "retired-model-nvfp4",
      "id": "retired-model-nvfp4",
      "servedNames": ["retired-model-nvfp4"],
      "displayName": "Retired Model NVFP4",
      "provider": "Example Provider",
      "providerLogo": "example-provider"
    }
  ],
  "models": []
}
```

Add a custom provider logo to `public/provider-logos/`, register its root-relative path in `src/provider-logos.js`, and add its checksum to `public/provider-logos/manifest.json`. Do not delete an icon while saved benchmark records or `historyModels` entries still reference it.
