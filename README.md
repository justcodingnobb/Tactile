# Tactile / 指痕

<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.png" width="120" alt="Tactile app icon" />
</p>

<p align="center">
  A local-first desktop dashboard for keyboard and mouse activity.
</p>

<p align="center">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri_2-24C8DB?logo=tauri&logoColor=white" />
  <img alt="Rust 1.85+" src="https://img.shields.io/badge/Rust-1.85%2B-000000" />
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB" />
  <img alt="Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue" />
</p>

<p align="center">
  <a href="README_ZH.md">简体中文</a> · English
</p>

Tactile measures how you use your keyboard and mouse without recording what
you type. It stores aggregate counts in a local SQLite database, supports macOS
and Windows, and makes no network requests in the current beta.

## Features

- **Mouse activity:** travel distance, button mix, wheel direction, and a
  24 x 16 click heatmap normalized to the main display.
- **Keyboard activity:** per-physical-key press counts, top keys, a keyboard
  heatmap, and the share of presses that used a modifier. While the window is
  open, the heatmap lights each key as it is pressed and the counts and ranking
  update live, so it doubles as a key tester.
- **Time views:** today, this week, this month, this year, or a custom range,
  with daily trends, hourly distribution, and previous-period comparisons.
- **Local by design:** no account, cloud sync, analytics, typed text, shortcut
  sequences, app names, window titles, screen contents, or raw pointer paths.
- **Desktop behavior:** pause and resume capture, global shortcuts, a tray menu,
  opt-in launch at login, light/dark themes, and Chinese/English UI.
- **Exports:** JSON, a six-file CSV ZIP archive, a 1080 x 1440 PNG share card,
  and a diagnostics JSON containing no statistics or device identifier.
- **Demo mode:** read-only sample data for exploring the UI without writing to
  the real database.

### Feature status

| Feature | Status |
| :--- | :--- |
| Mouse and keyboard statistics | ✅ Available |
| Click and keyboard heatmaps | ✅ Available |
| Daily trends and period comparisons | ✅ Available |
| Local SQLite persistence | ✅ Available |
| JSON, CSV, and share-card export | ✅ Available |
| Chinese and English UI | ✅ Available |
| Demo mode | ✅ Available |
| macOS and Windows desktop builds | ✅ Available from source |
| Release installers and update checker | ❌ Not configured |

## Quick Start

### Prerequisites

- Node.js 20+ (CI uses Node.js 24)
- Rust 1.85+
- The [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/)
  for macOS or Windows

### Run from source

```bash
npm install
npm run tauri:dev
```

For a UI-only browser preview:

```bash
npm run dev
```

Real input capture is available only in the desktop app. The browser preview
can render a share card, but does not read input or write the app database.

### Build

```bash
npm run tauri:build
```

The Tauri configuration targets DMG on macOS and NSIS on Windows. On macOS,
`npx tauri build --debug --bundles app` can produce the `.app` if DMG creation
is unavailable. The CI workflow builds a debug `.app` on macOS and a debug NSIS
installer on Windows.

## Development

```bash
npm test
npm run build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo check --workspace --no-default-features
```

The GitHub Actions workflow runs these checks on macOS and Windows.

### Project layout

```text
apps/desktop/              Tauri desktop shell and SQLite store
crates/trajectory-core/    Capture normalization, aggregation, stats, export
crates/trajectory-platform Input hooks and platform permissions
src/                       React dashboard and localization
```

## Platform Notes

### macOS

Input Monitoring permission is required to read keyboard and mouse events.
Grant it in **System Settings > Privacy & Security > Input Monitoring**, then
restart capture if needed. Tactile does not request Accessibility, Screen
Recording, Full Disk Access, or Location permission. Secure input is detected;
key counting is suppressed while it is active.

### Windows

Capture uses standard input hooks and works for a normal user. Events from
elevated applications may not be observed. Secure fields cannot be detected, so
their key presses may be counted. Pause capture when entering private input.

### Default shortcuts

| Action | macOS | Windows |
| :--- | :--- | :--- |
| Pause or resume capture | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| Show Tactile | `Cmd+Shift+T` | `Ctrl+Shift+T` |

Both shortcuts can be disabled in Settings.

### Build and distribution limits

Local macOS builds are ad-hoc/linker-signed, so the entitlements file is not
embedded by default. Windows and macOS release signing, notarization, and
distributable installers are not configured. Update checking is disabled and
not implemented.

## Data & Privacy

Tactile stores only aggregate counters in `trajectory.db` under the
per-user application-data directory:

- Minute buckets: retained for 48 hours.
- Hourly aggregates: retained for 90 days.
- Daily aggregates and daily key/click summaries: retained until cleared.
- Settings: theme, language, startup, shortcuts, and onboarding state.

The database is not encrypted by the application; it relies on operating-system
account and disk permissions. Clearing data from Settings currently removes all
application statistics, not a selected date range. OS backups may retain copies.

See [PRIVACY.md](PRIVACY.md) for the full data inventory and limitations.

## Technology

- [Tauri 2](https://tauri.app/) with React 19, TypeScript, and Vite
- Rust 2024 for input capture, aggregation, statistics, and exports
- SQLite through `rusqlite` for local persistence
- `rdev` and macOS Core Graphics event taps for platform input capture

## License

Licensed under the [Apache License 2.0](LICENSE).
