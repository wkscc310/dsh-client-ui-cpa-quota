# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [0.7.4] - 2026-09-01

### Changed

- **In-use window follows the refresh interval**: "in use" now means the
  account served the selected model within the current refresh cycle
  (previously a fixed 24 hours) — accounts that drop out of CPA's rotation
  leave the in-use view within one cycle, and the toggle label states the
  cycle semantics.

## [0.7.3] - 2026-09-01

### Fixed

- **Legacy ledger migration**: usage events recorded by pre-0.7.2 builds
  were keyed by the auth-file NAME (…@gmail.com.json) while accounts render
  by label — the in-use match never hit for them. Ledger events are now
  re-keyed to the rendered account name on ingest (idempotent), so existing
  history counts toward "in use" immediately after updating.

## [0.7.0] - 2026-09-01

### Added

- **In-use account detection**: the plugin polls CPA's per-request usage
  queue (`usage-queue`, non-destructively from the plugin's side) and keeps
  a per-instance 7-day ledger in the browser. Accounts that actually served
  the selected model in the last 24 hours are pinned in the tooltip with an
  "in use" badge, last-used time, and 24h request/token totals; the rest
  collapse under "Other accounts".
- **"Only show accounts in use" toggle** on the settings card (on by
  default) — turn it off to see every registry/family candidate again.
- **Usage-statistics detection**: when CPA's `usage-statistics-enabled`
  toggle is off, instance rows and tooltips say so (the in-use filter needs
  that queue to observe anything) — and the instance row offers a one-click
  enable button that writes `usage-statistics-enabled = true` into the CPA
  config (persisted).

## [0.6.1] - 2026-09-01

### Fixed

- **Stricter registry matching**: the per-account model match no longer
  treats a selected model as served when it merely extends a declared id in
  reverse — an account declaring only `gpt-5.5-mini` does not serve
  `gpt-5.5`.
- **Gray ring when every match is disabled**: if all accounts matching the
  selected model are disabled/unavailable, the ring is now gray (pending)
  instead of promising green quota.

## [0.6.0] - 2026-09-01

### Added

- **Exact per-account model matching**: the plugin now reads CPA's per-auth
  model registry (`GET /v0/management/auth-files/models?name=…`, the same
  table CPA's own router uses) and shows only the accounts that declare the
  selected model — so with multiple accounts on the same channel, all of them
  appear, while accounts on other channels that do not serve the model stay
  out. A declared list without the model excludes that account from every
  fallback; results are cached per account (10 min) so refreshes stay cheap.
- **Interactions API** provider recognized as its own channel (badge,
  family fallback for gemini/claude/gpt) without touching Antigravity, and
  **Vertex** accounts match Gemini/Claude families.

### Fixed

- **Codex accounts on current CPA builds**: the management API exposes
  `id_token` as an already-parsed claims object, which the plugin failed to
  read — the actual cause of the "missing chatgpt_account_id" errors. The
  claims object, `tokens.account_id`, and the header-less retry all work now.

## [0.5.0] - 2026-09-01

### Fixed

- **Codex "missing chatgpt_account_id"**: the ChatGPT account id is now also
  read from `tokens.account_id` / `account_id` (the canonical field in
  current CPA auth files) in addition to the JWT `id_token` copies, and an
  account with no recoverable id is still probed — without the account
  header — instead of failing outright.
- **Rings sometimes missing**: the CLIProxyAPI fingerprint probe now has a
  10s timeout (a hung request used to delay ring creation indefinitely), and
  an unreachable/unknown verdict is retried after 2 minutes instead of being
  cached for an hour — one transient network failure no longer hides the
  ring until the next hour.
- **Tooltip showed every account**: account filtering now falls back to the
  DSH provider id when the model name reveals no family (custom route
  names), recognizes more families (qwen, iflow, glm, deepseek), and — only
  when the family truly cannot be determined — lists every usable account
  with an explicit hint instead of silently doing so.

## [0.4.2] - 2026-08-30

### Changed

- README: added a Community section crediting LINUX DO and the
  awesome-dsh-plugin / dsh-market listing; removed the outdated
  `settings-card.png` screenshot.
- Release automation live: `v*` tags now test, publish to npm, and attach the
  tarball to the GitHub Release.

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
