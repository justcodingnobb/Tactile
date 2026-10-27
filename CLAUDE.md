# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Tactile (指痕) is a local-first Tauri 2 desktop app (macOS + Windows) that records aggregate keyboard/pointer statistics into a local SQLite DB. Privacy is the product: never capture typed text, shortcut sequences, app names, window titles, screen content, or raw pointer paths, and make no network requests. `PRIVACY.md` is the data inventory; keep it in sync when stored data changes.

## Commands

```bash
npm install
npm run tauri:dev        # full desktop app (Vite on 127.0.0.1:1420, strictPort)
npm run dev              # browser-only UI preview, uses mocks in src/lib/ipc.ts
npm run tauri:build      # DMG (macOS) / NSIS (Windows)
npx tauri build --debug --bundles app   # macOS .app when DMG creation fails
```

Checks (CI runs all of these on macOS and Windows, see `.github/workflows/build.yml`):

```bash
npm test                 # vitest run (jsdom, setup in src/test/setup.ts)
npm run build            # tsc -b && vite build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo check --workspace --no-default-features
```

Single tests:

```bash
npx vitest run src/lib/format.test.ts
npx vitest run -t "test name substring"
cargo test -p tactile-core <test_name>
cargo test -p tactile-desktop <test_name>   # e.g. database tests in database.rs
cargo test -p tactile-platform <test_name>
```

Rust edition 2024 (MSRV 1.85); let-chains (`if let ... && ...`) are used throughout.

## Architecture

Three Rust crates plus a React frontend:

- `crates/tactile-platform` — OS input hooks. `PlatformCapture` owns one capture session: `macos.rs` runs two Core Graphics event taps (keyboard, pointer) on their own run-loop threads; `rdev_listener.rs` is used elsewhere and is process-wide because `rdev::listen` can only start once. Pausing only gates events (`Control::paused`); `stop` sets `shutdown` and the tap threads release their hooks. Tap callbacks are wrapped in `catch_unwind` because a panic must not unwind into Core Graphics. `keymap.rs` maps keys to the stable codes used by core. Also owns permission checks, secure-input detection and `main_display_size`.
- `crates/tactile-core` — pure, platform-free logic. `EventNormalizer` (capture.rs) turns raw events into `InputEvent`s and suppresses key counting while secure input is active; `AggregationState` (aggregation.rs) folds events into time buckets and a 24x16 click heatmap normalized to the main display; `stats.rs` builds range presets and summaries; `export.rs` builds JSON/CSV bundles; `keys.rs` maps physical key codes to stable IDs/labels (modifiers have ids too, for live animation, but are never counted); `live.rs` (`LiveTracker`) collects per-tick deltas for the UI. Shared types live in `models.rs` and are serialized to the frontend via serde.
- `apps/desktop/src-tauri` — the Tauri shell. `runtime.rs` holds `RuntimeState` and documents the lock order (`flush_lock` → `capture` → `store`; status/fault/settings locks are leaves). `worker.rs` owns the platform hook and runs the capture loop under a `catch_unwind` supervisor. `flush.rs` moves buckets to SQLite. `commands.rs` holds the IPC commands; anything touching the DB, filesystem or dialogs is `#[tauri::command(async)]` so the main thread never blocks. `export.rs` opens native save dialogs itself (the webview never passes write paths) and writes atomically. `shortcuts.rs` has the tray and global shortcuts. `database.rs` is the `rusqlite` `Store`; if the DB file cannot be opened the app falls back to an in-memory store and reports `storage_error`.

Data flow: worker polls `PlatformCapture` → `EventNormalizer` → `AggregationState::ingest` and `LiveTracker`; every 40ms a `LivePulse` is emitted (only while the window is visible, see `set_live_enabled`), and every 5s `flush::flush` writes buckets to SQLite and emits `stats-flushed`. An hourly sweep purges minute buckets (>48h) and hour buckets (>90d); daily tables are kept until the user clears data. The worker also retries hook startup with exponential backoff and tracks permission/secure-input changes.

Status model: errors are recorded per `FaultSource` (Permission > Storage > Capture) and the top fault is merged into `CaptureState` by `publish_status`. Shortcut conflicts are reported separately in `CaptureState.shortcut_error` and never block capture. Use `set_fault`/`clear_fault` rather than setting status directly.

Live de-duplication: every `LivePulse` has a `seq`; `get_dashboard` returns `live_seq`, the last pulse already in stored data (read under `flush_lock`). The frontend (`src/lib/live.ts`, `src/hooks/useDashboard.ts`) only adds counts from pulses with `seq > live_seq` and re-applies buffered pulses after each refresh, so a press is never counted twice.

Backend → frontend events: `capture-status-changed`, `input-live` (`LivePulse`), `stats-flushed`, `settings-changed`.

Window close hides to tray instead of quitting; only explicit exit (tray Quit) ends the process, and `RuntimeState::finalize` flushes on exit.

### Frontend (`src/`)

- `src/lib/ipc.ts` wraps every `invoke` and `listen`. It detects Tauri via `__TAURI_INTERNALS__` and otherwise serves mock data (`mockState`, `src/lib/demo.ts`), which is what `npm run dev` and vitest use. New commands need both the Tauri path and a browser fallback, plus registration in `generate_handler!` in `lib.rs`.
- `src/types.ts` mirrors the Rust `models.rs` types (snake_case fields). Change both together.
- `src/i18n.ts` holds the zh/en string tables; all UI text must be added to both.
- Demo mode is read-only: it must never write to the real database.
- Pages live in `src/pages/`; `App.tsx` only wires state (`useAppControl`, `useDashboard`) to pages. Key-press animation goes through `src/lib/liveBus.ts` and toggles DOM classes in `Keyboard.tsx`, so typing does not re-render the app; keycap `data-key` values must match the ids from `keys.rs::key_id_string`.

## Platform caveats

- macOS needs Input Monitoring permission only; do not add Accessibility, Screen Recording, or other permissions.
- Windows cannot detect secure input fields, and hooks may miss events from elevated apps.
- The CSP in `tauri.conf.json` only allows `ipc:` connections; keep the app network-free.
- Release signing/notarization are not configured; the updater is configured via
  `tauri-plugin-updater` with GitHub `latest.json`. `.github/workflows/release.yml`
  builds draft releases on `v*` tags, and `npm run version:set -- <semver>` keeps
  package/Cargo versions aligned. Tauri-action generates `latest.json`; publishing
  jobs run serially so the per-platform manifests merge instead of racing.
- Launch at login is opt-in (`AppSettings::default` has it off).
- The product name, crate names, bundle identifier and database filename all use Tactile.
- Browser preview: `npm run dev` then open `http://127.0.0.1:1420/?preview=keyboard` (or `overview`, `mouse`, `trends`, `settings`) to land in demo mode on that page. Dev builds only.
