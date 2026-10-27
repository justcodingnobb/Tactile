//! File exports. The destination always comes from a native save dialog
//! opened here, so the webview can never pick an arbitrary path to write.

use crate::runtime::{RuntimeState, StatsRequest, lock};
use chrono::{Local, Utc};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use trajectory_core::export::{build_csv_bundle, build_json_export, demo_snapshot};
use trajectory_core::models::{ExportBundle, Heatmap};
use trajectory_platform::permission_granted;
use trajectory_platform::secure_input::is_secure_input_enabled;
use zip::write::SimpleFileOptions;

const DEMO_HEATMAP_TOTAL_RATIO: f64 = 0.92;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DataFormat {
    Json,
    Zip,
}

impl DataFormat {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "json" => Ok(Self::Json),
            "zip" => Ok(Self::Zip),
            other => Err(format!("unsupported export format: {other}")),
        }
    }
}

pub enum SaveTarget {
    Data(DataFormat),
    ShareCard,
    Diagnostics,
}

impl SaveTarget {
    fn file_name(&self) -> String {
        let today = Local::now().date_naive();
        match self {
            Self::Data(DataFormat::Json) => format!("tactile-{today}.json"),
            Self::Data(DataFormat::Zip) => format!("tactile-{today}.zip"),
            Self::ShareCard => format!("tactile-share-{today}.png"),
            Self::Diagnostics => format!("tactile-diagnostics-{today}.json"),
        }
    }

    fn filter(&self) -> (&'static str, &'static [&'static str]) {
        match self {
            Self::Data(DataFormat::Json) | Self::Diagnostics => ("JSON", &["json"]),
            Self::Data(DataFormat::Zip) => ("ZIP", &["zip"]),
            Self::ShareCard => ("PNG", &["png"]),
        }
    }
}

/// Opens a native save dialog. Must not run on the main thread (commands
/// using it are async), because the blocking variant waits for the UI loop.
pub fn choose_path(app: &AppHandle, target: SaveTarget) -> Result<Option<PathBuf>, String> {
    let (name, extensions) = target.filter();
    let picked = app
        .dialog()
        .file()
        .set_file_name(target.file_name())
        .add_filter(name, extensions)
        .blocking_save_file();
    picked
        .map(|path| path.into_path().map_err(|error| error.to_string()))
        .transpose()
}

/// Writes to a sibling temp file and renames it, so a failed export never
/// leaves a truncated file at the destination.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = temp_path(path);
    let result = fs::write(&temp, bytes).and_then(|()| fs::rename(&temp, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|error| error.to_string())
}

fn temp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".partial");
    path.with_file_name(name)
}

pub fn write_data(
    state: &RuntimeState,
    request: &StatsRequest,
    format: DataFormat,
    path: &Path,
) -> Result<(), String> {
    let bundle = build_bundle(state, request)?;
    let bytes = match format {
        DataFormat::Json => build_json_export(&bundle)
            .map_err(|error| error.to_string())?
            .into_bytes(),
        DataFormat::Zip => build_zip(&bundle)?,
    };
    write_atomic(path, &bytes)
}

fn build_bundle(state: &RuntimeState, request: &StatsRequest) -> Result<ExportBundle, String> {
    let range = state.effective_range(request);
    let demo = state.is_demo();
    let (stats, click_grid) = if demo {
        (demo_snapshot(), demo_heatmap())
    } else {
        let store = lock(&state.store);
        let stats = store.stats(&range).map_err(|error| error.to_string())?;
        let grid = store
            .click_heatmap(&range)
            .map_err(|error| error.to_string())?;
        (stats, grid)
    };
    let version = env!("CARGO_PKG_VERSION");
    Ok(ExportBundle {
        schema_version: 1,
        exported_at: Utc::now(),
        app_version: if demo {
            format!("{version}-DEMO")
        } else {
            version.into()
        },
        range: stats.range.clone().unwrap_or(range),
        timezone: Local::now().offset().to_string(),
        totals: stats.totals,
        daily: stats.series,
        keys: stats.keys,
        buttons: stats.buttons,
        click_grid,
    })
}

fn build_zip(bundle: &ExportBundle) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, body) in build_csv_bundle(bundle, &bundle.click_grid) {
        zip.start_file(name, options)
            .map_err(|error| error.to_string())?;
        zip.write_all(body.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    zip.finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|error| error.to_string())
}

pub fn write_diagnostics(state: &RuntimeState, path: &Path) -> Result<(), String> {
    let database_bytes = lock(&state.store).database_size();
    let report = serde_json::json!({
        "generatedAt": Utc::now(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "status": state.current_status(),
        "databaseBytes": database_bytes,
        "volatileStorage": state.storage_volatile.is_some(),
        "permission": permission_granted(),
        "secureInput": is_secure_input_enabled(),
    });
    let bytes = serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?;
    write_atomic(path, &bytes)
}

pub fn demo_heatmap() -> Heatmap {
    let base_cells: Vec<u64> = (0..24 * 16)
        .map(|index| {
            let column = f64::from(index % 24);
            let row = f64::from(index / 24);
            let distance = (column - 9.0).hypot(row - 7.0);
            (180.0 - distance * 19.0).max(0.0).round() as u64
        })
        .collect();
    let target = (demo_snapshot().totals.clicks as f64 * DEMO_HEATMAP_TOTAL_RATIO).floor();
    let base_total = base_cells.iter().sum::<u64>();
    let scale = if base_total > 0 {
        target / base_total as f64
    } else {
        0.0
    };
    let cells: Vec<u64> = base_cells
        .into_iter()
        .map(|value| (value as f64 * scale).round() as u64)
        .collect();
    Heatmap {
        columns: 24,
        rows: 16,
        max_value: cells.iter().copied().max().unwrap_or(0),
        filtered_total: cells.iter().sum(),
        cells,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_format_is_rejected() {
        assert!(DataFormat::parse("exe").is_err());
        assert_eq!(DataFormat::parse("zip"), Ok(DataFormat::Zip));
    }

    #[test]
    fn atomic_write_replaces_file_and_leaves_no_temp() {
        let directory = std::env::temp_dir().join(format!(
            "trajectory-export-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("out.json");
        fs::write(&path, b"old").unwrap();
        write_atomic(&path, b"new").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert!(!temp_path(&path).exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn demo_heatmap_totals_match_cells() {
        let heatmap = demo_heatmap();
        assert_eq!(heatmap.cells.len(), 24 * 16);
        assert_eq!(heatmap.filtered_total, heatmap.cells.iter().sum::<u64>());
        assert_eq!(
            heatmap.max_value,
            heatmap.cells.iter().copied().max().unwrap_or(0)
        );
        assert!(heatmap.filtered_total < demo_snapshot().totals.clicks);
    }
}
