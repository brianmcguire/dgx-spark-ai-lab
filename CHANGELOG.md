# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

## 1.5.0 - 2026-09-12

### Added

- Live primary and secondary LLM cards with a running-model count and per-service GPU memory readings. The Linux probe maps GPU processes to online PM2 services, including the configured primary Docker container; unsupported or failed probes display unavailable status.
- Collapsible archive for unavailable checkpoints, preserving specifications and model links without inactive launch controls. Installed, loading, and running models remain in the main catalog.
- Configurable one-to-four Spark illustrations and independent or linked layouts, explicitly separate from device discovery and distributed inference.

### Changed

- Compact green and blue gradient model headers distinguish primary and secondary roles, enlarge model names and memory values, and stack on mobile.
- Connection aliases are expandable to keep the controller header concise.
- Benchmark presentation uses clearer performance summaries, charts, and configuration-aware history.

### Fixed

- Canonical checkpoint names take precedence over shared compatibility aliases in model and benchmark presentation.
- Secondary model cards show their running status while primary controls continue to target only the primary service.


## 1.4.0 - 2026-09-06

### Added

- Bundled DGX Spark illustration with animated rear-cable highlights and a subtle pulse in the original underglow. The artwork blends into the header without a rectangular background.
- Decorative animation pause/resume control, reduced-motion support, and automatic pausing when the scene or browser tab is hidden. Animation does not represent live token counts or issue inference requests.
- Prefill batch limits in saved inference configurations and benchmark labels, with separate comparison series for different batch sizes. Older records remain unchanged when this setting was not recorded.

### Changed

- The health dashboard combines infrastructure identity, Spark artwork, the active vLLM model, and collector cadence in a responsive header with larger text and vertically grouped details.
- Blue accents, page transitions, aligned telemetry values, and a labeled gradient temperature bar improve dashboard readability.
- The Qwen 3.8 27B NVFP4 recipe uses vLLM 0.28.0, a 4,096-token prefill batch, and a 0.55 startup memory-utilization threshold while retaining its fixed FP8 KV cache and MTP3 settings. These are recipe defaults, not a universal performance guarantee or an automatic update to running services.

### Fixed

- Model metadata overlays stay above adjacent cards, and large telemetry values avoid right-edge clipping.
- Header text and matching-height model/collector cards adapt from mobile to ultrawide displays.

## 1.3.0 - 2026-08-31

### Added

- Qwen 3.8 27B BF16 is available as a guarded DGX Spark model-controller recipe with text, image, and video capabilities.
- Qwen 3.8 27B NVFP4 is available as a separate Unsloth mixed-precision recipe tuned for lower DGX Spark memory and bandwidth pressure, with three-token MTP speculative decoding and a conservative four-sequence limit.
- Benchmark records now save safe model-presentation snapshots, and `historyModels` supplies names and icons for older records after a checkpoint is deleted.
- A checksum manifest and retention test protect bundled provider-logo assets that saved benchmark history still uses.

### Changed

- Live vLLM telemetry now leads with an operations strip that gives decode throughput, prompt throughput, active and queued requests, and KV-cache usage stronger visual hierarchy.
- Docker-backed model launches retain vLLM compilation caches between model switches and use explicit unified-memory reservations for the Qwen 3.8 and Nemotron 3.5 Lightning profiles.
- Model Controller and Benchmark Lab metadata now identify Qwen 3.8 NVFP4's MTP3 configuration, and new benchmark records preserve the complete inference configuration used for each result.
- Benchmark leaderboards separate different inference configurations of the same checkpoint into distinct comparison rows instead of averaging MTP1 and MTP3 results together.
- Empty replacement catalogs now remove every built-in controller recipe while leaving history-only model metadata available to the benchmark views.

## 1.2.1 - 2026-08-13

### Fixed

- Saved benchmark history is now inventoried independently of the selected comparison template, with a direct path from an empty suite leaderboard to compatible legacy single-scenario runs.
- Single-scenario history now opens on the fair comparison covering the most models, and provider metadata remains available while the inference endpoint is offline so leaderboard logos still render.
- New benchmark records retain their canonical catalog model identity, and remote profiles can resolve the configured vLLM API key after process-manager restarts.
- Saved model history now merges legacy served names with newer catalog identities, so each actual model has one card without losing earlier records.
- The environment doctor now reports unavailable inference endpoints as warnings in the safe read-only starter profile while retaining hard failures when benchmarks or full controls require the endpoint.
- The HTML app shell now disables browser caching so deployments cannot remain stuck on an obsolete JavaScript bundle; fingerprinted assets retain long-lived immutable caching.

### Changed

- The compact mobile diagnostic action is labeled Spark Doctor consistently with the desktop interface.

## 1.2.0 - 2026-08-13

### Added

- Guided Settings screen for common branding, connection, endpoint, and optional-service configuration.
- Safe settings persistence with environment-managed field protection.
- JSON Schema for advanced configuration editors.
- GitHub issue and pull request templates.
- Automatic model discovery and portable model catalog support.
- Runtime-detected optional Spark Doctor integration with upstream attribution.
- Recursive credential redaction for Spark Doctor reports and command-line diagnostics before API exposure.

### Changed

- Configuration and setup documentation now distinguish browser-managed settings from protected advanced settings.
- Persisted benchmark records are normalized and reloaded so legacy Coding and Visual Analysis history remains available after restarts.

## 1.1.0 - 2026-08-12

### Added

- Portable local, remote SSH, benchmark, and full-control profiles.
- Model Controller and repeatable coding and visual benchmark suites.
- Retained inference and system performance telemetry.
- Configurable branding, optional PM2 and gateway collectors, setup doctor, and CI checks.
