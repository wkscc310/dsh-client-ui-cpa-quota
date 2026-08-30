# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [0.4.1] - 2026-08-30

### Added

- Clicking a quota ring opens Settings → Plugins with the CliProxyAPI card
  expanded (best-effort; quietly does nothing when a surface is missing).
- Config **export/import** on the settings card: instances and keys move
  between browsers as a JSON file. Imported entries are normalized (valid
  instances only, `refreshMinutes` clamped) before replacing the config.
- Release automation: pushing a `v*` tag runs the tests, publishes to npm
  (`NPM_TOKEN` repository secret required) and attaches the packed tarball to
  the GitHub Release.

## [0.4.0] - 2026-08-30

### Added

- **One-command install**: the plugin now declares a `dsh.bundle` manifest
  (`cordis.patch.yml` in the package root), so
  `dsh plugin --profile web add github:wkscc310/dsh-client-ui-cpa-quota`
  installs and activates it in one step — no config editing, and no
  `declares no dsh.bundle` warning.
- `screenshots.json` so storefronts such as
  [dsh-market](https://github.com/dsh-market/dsh-market) can show
  AppStore-style screenshots.

### Changed

- The installers recognize bundle mode: `dsh plugin add` activation skips the
  manual loader entry, and a legacy manual entry written by older installers
  is migrated away automatically (a hand-customized entry is kept with a
  warning). The copy fallback still writes the entry, because nothing
  reconciles the bundle layer in that mode.

## [0.3.0] - 2026-08-30

### Added

- Collapsible settings card matching the built-in plugin cards, with a
  **quota health dot** in the header: green healthy, amber under 20%, red
  exhausted/refresh-failed, gray waiting or keyless.
- **All-accounts panel** in the settings card, styled after CPA's management
  center: every account of every instance with all of its quota windows,
  subscription plan, and provider badge — not filtered by the current model.
- **Refresh now** re-fingerprints provider `baseURL`s immediately, so a newly
  added CPA instance no longer waits out the one-hour probe cache.
- `tests/mock-cpa.mjs`: a fake CLIProxyAPI instance (five demo accounts) for
  manual testing and screenshots without a real deployment.

### Fixed

- The settings card's per-account panel no longer rebuilds every second (the
  refresh clock re-render used to reset its scroll position while browsing).
- A hung upstream can no longer wedge the refresh cycle: every upstream probe
  now has a 20s per-request timeout, and account probes run through a bounded
  concurrency pool (5) instead of unbounded `Promise.all`.
- Saving one instance's key no longer persists empty-key discovered instances
  into `localStorage` (which used to turn them into raw 401 errors), and an
  empty key is now always treated as "not configured".
- The 2xx fingerprint verdict no longer matches arbitrary bodies containing
  `true`/`false`; it now requires CPA-shaped content.
- Quota snapshots of removed instances are pruned from the in-memory cache.

### Changed

- Targets the current dsh plugin contract (validated against `dsh`
  0.1.1-rc.2): the settings card registers under the `cpa-quota` settings
  namespace served by the node half, and installation goes through
  `dsh plugin --profile web add` with a copy-based fallback.
- The node half is deliberately dependency-free, so every install mode
  (pnpm link, direct copy, shared profiles `node_modules`) resolves.

## [0.2.0] - 2026-08-30

### Changed

- Adapted to the current dsh harness settings-namespace-keyed plugin cards
  and the `dsh plugin` install flow.

## [0.1.0] - 2026-08-16

### Added

- Initial release: quota ring beside the model picker, hover tooltip with
  per-account provider quotas for Codex, Claude, Antigravity, Gemini CLI,
  Kimi, and xAI/Grok, automatic CLIProxyAPI fingerprint discovery, and a
  settings card for management keys.
