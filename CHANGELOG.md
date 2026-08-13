# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

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
