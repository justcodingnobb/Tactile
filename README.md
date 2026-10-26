# Trajectory / 轨迹

Trajectory is a local-first desktop dashboard for keyboard and pointer activity
on macOS and Windows. It records aggregate counts, never text or raw movement
paths, and keeps all statistics on the current device.

## What It Tracks

- Pointer travel distance, left/right/middle/side button clicks, and scroll
  direction.
- Per-physical-key press counts and the share of presses that used a modifier.
- Activity by minute, hour, and local day, with daily trends and a normalized
  click heatmap.
- Aggregate-only local storage: no keystrokes, typed text, app names, window
  titles, shortcut sequences, or raw cursor paths.

The app provides overview, pointer, keyboard, trends, and settings views in
Chinese and English, plus light/dark themes and demo data.

## Stack

- [Tauri 2](https://tauri.app/) desktop shell
- Rust input capture, aggregation, and SQLite storage
- React 19, TypeScript, and Vite dashboard

## Development

Prerequisites: Node.js 20+, Rust 1.85+, and the
[Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for your
platform.

```bash
npm install
npm run tauri:dev
```

Run the browser-only preview with `npm run dev`. Real capture and file export
are available only in the desktop app.

## Verification

```bash
npm test
npm run build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo check --workspace --no-default-features
npx tauri build --debug
```

On macOS, `npx tauri build --debug` can build the `.app` even when DMG creation
is blocked by the environment. The DMG step uses Finder through AppleScript and
may need an interactive desktop session.

## Permissions And Platforms

- **macOS:** Input Monitoring is required. Grant it in System Settings, then
  restart capture if needed. The app requests no Accessibility, Screen
  Recording, Full Disk Access, or Location permission.
- **Windows:** Capture works as standard input hooks for a normal user. Elevated
  applications may not be observed; secure fields are not detectable and may
  contribute key counts. Pause capture when private input is expected.

Local macOS builds are ad-hoc/linker-signed only, so the entitlements file is
not embedded in that development bundle. Windows and macOS release signing,
notarization, and distributable installers are not configured. The update
checker is not implemented and currently disabled.

## Data And Privacy

Statistics are stored in a local SQLite database under the platform app-data
directory. See [PRIVACY.md](PRIVACY.md) for the complete data inventory,
retention policy, and limitations.

## License

[MIT](LICENSE)
