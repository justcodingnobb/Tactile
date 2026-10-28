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
you type. It stores aggregate counts in a local SQLite database and supports
macOS and Windows. Its only network request is the optional update check to
GitHub; it sends no statistics and can be disabled in Settings.

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
| GitHub release pipeline | ✅ Configured |
| Signed in-app updates | ✅ Available when release signing is configured |

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
is unavailable. Local unsigned updater-artifact builds fail unless you disable
the updater artifacts for that build:

```bash
npx tauri build --debug --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Set `TAURI_SIGNING_PRIVATE_KEY` to produce `.app.tar.gz`, `.app.tar.gz.sig`,
and NSIS updater artifacts. Without it, use the override above.

`npm run tauri:build` intentionally launches a normal bundled build; use the
command above when building updater artifacts locally without a signing key.

The CI workflow builds a debug `.app` on macOS and a debug NSIS installer on
Windows.

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
apps/desktop/               Tauri desktop shell and SQLite store
crates/tactile-core/        Capture normalization, aggregation, stats, export
crates/tactile-platform/    Input hooks and platform permissions
src/                        React dashboard and localization
```

## Platform Notes

### macOS

Input Monitoring permission is required to read keyboard and mouse events.
Grant it in **System Settings > Privacy & Security > Input Monitoring**, then
restart capture if needed. Tactile does not request Accessibility, Screen
Recording, Full Disk Access, or Location permission. Secure input is detected;
key counting is suppressed while it is active.

Tactile is not signed with an Apple Developer ID or notarized. After
installing from the DMG, macOS may report "“Tactile.app” is damaged and can't
be opened. You should move it to the Trash." (Chinese systems: “Tactile.app”
已损坏，无法打开。你应该将它移到废纸篓。). Remove the quarantine attribute in
Terminal, then open the app again:

```bash
sudo xattr -r -d com.apple.quarantine /Applications/Tactile.app
```

This is only needed once per manual download; in-app updates do not need it.

macOS binds Input Monitoring permission to the app's code signature. After replacing an
older Tactile build, remove Tactile from Input Monitoring (or run
`tccutil reset ListenEvent com.tactile.desktop`), relaunch, and grant permission
again if events are not recorded.

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

macOS builds are ad-hoc signed with the configured entitlements. Developer ID
signing and notarization are not configured, so distributed builds still
trigger Gatekeeper warnings (see the quarantine note under macOS). The in-app updater is signed with the Tauri
updater key independently of platform code signing.

### Releasing

1. Bump all version sources: `npm run version:set -- 0.2.0`.
2. Commit the version change and wait for the normal build checks.
3. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
4. Wait for the `release` workflow to publish the GitHub release and
   `latest.json`.

Configure the repository secret `TAURI_SIGNING_PRIVATE_KEY` before creating the
tag. If the key has a password, also configure
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; leave it unset for a passwordless key.
The workflow produces macOS arm64/x86_64 and Windows artifacts through
`tauri-apps/tauri-action`; `latest.json` is generated by the action from the
signed artifacts. Publish jobs run serially so each platform is merged into one
manifest. The updater endpoint points at
`releases/latest/download/latest.json`. Releases are published directly rather
than as drafts so manifest URLs are public downloads. Beta tags are published
as normal releases so `releases/latest` resolves to their `latest.json`.

## Data & Privacy

Tactile stores only aggregate counters in `tactile.db` under the
per-user application-data directory:

- Minute buckets: retained for 48 hours.
- Hourly aggregates: retained for 90 days.
- Daily aggregates and daily key/click summaries: retained until cleared.
- Settings: theme, language, startup, shortcuts, onboarding state, and the
  update-check preference.

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
