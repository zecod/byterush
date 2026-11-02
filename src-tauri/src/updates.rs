//! Updates: ask byterush.xyz whether a newer release is out and install it in one click.
//!
//! The site answers `GET /api/update/{target}/{arch}/{bundle_type}/{current_version}` with 204
//! when the app is current, or with the newest release: its version, the address of the installer
//! for this kind of install, that installer's signature, and the notes of every release since the
//! running one. The installer is checked against the public key in `tauri.conf.json` before it
//! runs, so only a release signed with the project's private key can be installed, whatever the
//! site or the network hand over.

use crate::engine::Manager;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager as _, State, ipc::Channel};
use tauri_plugin_updater::{Update, UpdaterExt};

/// How long the engine may take to write what its connections received before the app goes.
const FLUSH: Duration = Duration::from_millis(1500);

/// The update found by the last check, kept until it is installed.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

/// One release's notes, as the site lists them (its CHANGELOG.md section, in Markdown).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ReleaseNotes {
    pub version: String,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub date: Option<String>,
    /// Every release newer than the running one, newest first.
    pub releases: Vec<ReleaseNotes>,
}

/// What the install sends back while it runs.
#[derive(Serialize, Clone)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Progress {
    Downloading {
        downloaded: u64,
        total: Option<u64>,
    },
    /// The installer was checked and starts now; the app closes (and comes back) shortly.
    Installing,
}

fn info_of(update: &Update) -> UpdateInfo {
    let raw = &update.raw_json;
    let date = raw.get("pub_date").and_then(|d| d.as_str()).map(str::to_string);
    let mut releases: Vec<ReleaseNotes> = raw.get("releases").and_then(|r| serde_json::from_value(r.clone()).ok()).unwrap_or_default();
    // an answer without the list (another server, an older site): the latest release's own notes
    if releases.is_empty() {
        releases.push(ReleaseNotes { version: update.version.clone(), date: date.clone(), notes: update.body.clone().unwrap_or_default() });
    }
    UpdateInfo { version: update.version.clone(), current_version: update.current_version.clone(), date, releases }
}

/// Words for the settings card instead of the updater's own ("error sending request for url…").
fn readable(e: tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    match e {
        E::Reqwest(_) | E::Network(_) => format!("couldn't reach byterush.xyz ({e})"),
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) | E::SignedVersionMismatch { .. } | E::MissingSignedVersion => {
            "the downloaded update isn't signed by byterush, so it wasn't installed".into()
        }
        _ => e.to_string(),
    }
}

/// Ask the site whether there is a newer version. `None`: this is the latest.
#[tauri::command]
pub async fn check_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    let manager = app.state::<Manager>().inner().clone();
    let updater = app
        .updater_builder()
        // a stalled connection fails instead of hanging the card; a slow one still finishes
        .configure_client(|client| client.connect_timeout(Duration::from_secs(15)).read_timeout(Duration::from_secs(30)))
        // Windows: the installer replaces the running app, which exits right after starting it.
        // Running downloads first write what they received; they continue after the restart.
        .on_before_exit(move || manager.shutdown(FLUSH))
        .build()
        .map_err(readable)?;
    let update = updater.check().await.map_err(readable)?;
    let info = update.as_ref().map(info_of);
    *pending.0.lock().unwrap() = update;
    Ok(info)
}

/// Download the update found by `check_update`, check its signature, install it and restart.
/// On Windows the installer takes over (it shows its progress and starts the new version);
/// elsewhere the app replaces itself and restarts.
#[tauri::command]
pub async fn install_update(app: AppHandle, pending: State<'_, PendingUpdate>, on_progress: Channel<Progress>) -> Result<(), String> {
    // taken out while it installs, so a second click can't start a second download
    let update = pending.0.lock().unwrap().take().ok_or("there is no update to install: check again")?;
    let mut downloaded = 0u64;
    let mut sent = Instant::now() - Duration::from_secs(1);
    let result = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                // a few updates a second are plenty for a progress bar
                if sent.elapsed() >= Duration::from_millis(120) {
                    sent = Instant::now();
                    let _ = on_progress.send(Progress::Downloading { downloaded, total });
                }
            },
            || {},
        )
        .await;
    let bytes = match result {
        Ok(bytes) => bytes,
        Err(e) => {
            *pending.0.lock().unwrap() = Some(update);
            return Err(readable(e));
        }
    };
    let _ = on_progress.send(Progress::Installing);
    if let Err(e) = update.install(&bytes) {
        *pending.0.lock().unwrap() = Some(update);
        return Err(readable(e));
    }
    // only macOS and Linux get here (Windows exited for its installer)
    let manager = app.state::<Manager>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.shutdown(FLUSH)).await.ok();
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_notes_read_the_sites_list() {
        let raw = serde_json::json!([
            { "version": "0.3.4", "date": "2026-11-09T10:00:00Z", "notes": "### Fixed\n\n- a" },
            { "version": "0.3.3", "notes": "### Added\n\n- b" }
        ]);
        let list: Vec<ReleaseNotes> = serde_json::from_value(raw).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].date, None);
        assert_eq!(list[1].notes, "### Added\n\n- b");
    }
}
