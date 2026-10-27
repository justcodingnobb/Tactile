# Privacy

Tactile is designed as an offline, local-only input statistics tool. It does
not include an account system, cloud sync, advertising, analytics, or usage
telemetry. Its only network request is the optional update check to
`github.com`. The check sends no statistics, input data, or device identifier.
As with any HTTP request, GitHub receives standard request metadata such as the
IP address, updater user agent, and request time. Disable automatic checks in
Settings at any time.

## Data Stored

The local SQLite database contains aggregate counters:

- Pointer distance in logical pixels, scroll direction, and button counts.
- Per-physical-key press counts and shortcut-press counts.
- Clicks in a 24 by 16 grid normalized to the main display.
- Active seconds and minute, hour, and local-day aggregates.
- Local preferences such as theme, language, autostart, shortcuts, and
  onboarding completion.
- The last update-check time, stored in webview local storage.

The database does not store typed text, individual key sequences, clipboard
contents, application names, window titles, screen contents, or raw pointer
paths. An exported diagnostics file contains only app/platform versions,
permission state, storage size, and a redacted device identifier.

## Retention

- Minute buckets: 48 hours.
- Hourly aggregates: 90 days.
- Daily aggregates and daily key/click summaries: retained until manually
  cleared.

Clear a range from Settings to delete matching data from the app database.
Operating-system backups may retain copies outside the app's control.

## Storage Location

The database is named `tactile.db` and lives in the operating system's
per-user application-data directory for Tactile. Data is protected by the
local OS account and disk permissions. The app does not add its own database
encryption.

On Windows, the default location is typically under
`%APPDATA%\com.tactile.desktop` or `%LOCALAPPDATA%\com.tactile.desktop`.
On macOS, it is typically under
`~/Library/Application Support/com.tactile.desktop`.

## Platform Limitations

On macOS, reading keyboard and pointer events requires Input Monitoring.
Secure input suppresses key counting while active. On Windows, secure fields
and elevated applications have platform-level limitations and may not be
detectable; users should pause capture for private input.

The app binds two global shortcuts by default. Disable them in Settings if they
conflict with other software. Tray and shortcut state are local only.
