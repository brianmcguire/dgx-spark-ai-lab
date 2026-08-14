# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Qwen 3.8 27B BF16 is available as a guarded DGX Spark model-controller recipe with text, image, and video capabilities.

### Changed

- Docker-backed model launches retain vLLM compilation caches between model switches and use explicit unified-memory reservations for the Qwen 3.8 and Nemotron 3.5 Lightning profiles.

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
