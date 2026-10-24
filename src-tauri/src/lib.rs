pub mod bridge;
pub mod engine;

use engine::{AddRequest, Confirmation, DiskSpace, DownloadView, Manager, ProbeInfo, Settings};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager as _, RunEvent, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;

/// Set by the UI to receive every row again (on startup or after a reload).
#[derive(Default)]
struct Resync(Arc<AtomicBool>);

/// Only rows that changed since the previous event, so thousands of downloads stay cheap.
#[derive(Serialize, Clone)]
struct Delta {
    full: bool,
    upserts: Vec<DownloadView>,
    removed: Vec<String>,
}

#[derive(Serialize)]
struct AddManyResult {
    ids: Vec<String>,
    errors: Vec<String>,
}

struct BridgeState(Arc<Mutex<bridge::BridgeStatus>>);

#[derive(Serialize, Clone)]
struct Captured {
    id: String,
    source: String,
    /// It waits for the user in its "New download" window.
    waiting: bool,
}

/// Label of the "New download" window of a download.
const CONFIRM_PREFIX: &str = "confirm-";

#[tauri::command(async)]
fn bridge_status(state: State<'_, BridgeState>) -> bridge::BridgeStatus {
    state.0.lock().unwrap().clone()
}

/// The unpacked extension shipped with the app (repo folder in development).
fn extension_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    let bundled = app.path().resource_dir().ok().map(|d| d.join("extension"));
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../extension");
    [bundled, Some(dev)].into_iter().flatten().find(|d| d.join("manifest.json").exists())
}

#[tauri::command(async)]
fn open_extension_folder(app: AppHandle) -> Result<String, String> {
    let dir = extension_dir(&app).ok_or("extension folder not found")?;
    let dir = dir.canonicalize().unwrap_or(dir);
    let shown = dir.to_string_lossy().trim_start_matches(r"\?\").to_string();
    app.opener().open_path(&shown, None::<&str>).map_err(|e| e.to_string())?;
    Ok(shown)
}

#[tauri::command(async)]
fn sync_downloads(manager: State<'_, Manager>, resync: State<'_, Resync>) {
    resync.0.store(true, Ordering::Relaxed);
    manager.poke();
}

/// Give an unfinished download a new address (its link expired) and continue it.
#[tauri::command]
async fn refresh_download(manager: State<'_, Manager>, id: String, url: String) -> Result<(), String> {
    manager.refresh(&id, &url).await
}

#[tauri::command(async)]
fn get_download(manager: State<'_, Manager>, id: String) -> Option<DownloadView> {
    manager.get(&id)
}

#[tauri::command]
async fn add_downloads(manager: State<'_, Manager>, requests: Vec<AddRequest>) -> Result<AddManyResult, String> {
    let (ids, errors) = manager.add_many(requests).await;
    Ok(AddManyResult { ids, errors })
}

#[tauri::command]
async fn probe_url(manager: State<'_, Manager>, url: String) -> Result<ProbeInfo, String> {
    manager.probe(&url).await
}

#[tauri::command]
async fn add_download(manager: State<'_, Manager>, request: AddRequest) -> Result<String, String> {
    manager.add(request).await
}

#[tauri::command(async)]
fn pause_downloads(manager: State<'_, Manager>, ids: Vec<String>) {
    manager.pause(&ids);
}

#[tauri::command(async)]
fn resume_downloads(manager: State<'_, Manager>, ids: Vec<String>) {
    manager.resume(&ids);
}

#[tauri::command(async)]
fn remove_downloads(manager: State<'_, Manager>, ids: Vec<String>, delete_files: bool) {
    manager.remove(&ids, delete_files);
}

/// The answer from a "New download" window. Starting brings the main window forward with the
/// download in it, the way a download manager shows its progress.
#[tauri::command(async)]
fn confirm_download(app: AppHandle, manager: State<'_, Manager>, id: String, choice: Confirmation) -> Result<String, String> {
    let start = choice.start;
    let file_name = manager.confirm(&id, choice)?;
    if start && let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(file_name)
}

#[tauri::command(async)]
fn disk_space(dir: String) -> Option<DiskSpace> {
    engine::disk_space(std::path::Path::new(&dir))
}

/// Ask the user about a download the browser handed over, IDM style: a small window on top of the
/// browser with its name, size, folder and the room left on that drive. It holds the download
/// until answered (see `Manager::confirm`); closing it keeps the download paused for later.
fn open_confirm_window(app: &AppHandle, id: &str) {
    let label = format!("{CONFIRM_PREFIX}{id}");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_focus();
        return;
    }
    // the window learns which download it is about from its label
    let built = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::default())
        .title("New download · Byterush")
        .inner_size(620.0, 452.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .center()
        .focused(true)
        // shown by the UI once drawn, like the main window
        .visible(false)
        .build();
    match built {
        Ok(window) => {
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1500));
                if !window.is_visible().unwrap_or(true) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });
        }
        // no window to ask in: don't keep the download waiting
        Err(_) => {
            let _ = app.state::<Manager>().confirm(id, Confirmation { start: true, ..Default::default() });
        }
    }
}

#[tauri::command(async)]
fn get_settings(manager: State<'_, Manager>) -> Settings {
    manager.settings()
}

#[tauri::command(async)]
fn save_settings(manager: State<'_, Manager>, settings: Settings) {
    manager.update_settings(settings);
}

#[tauri::command(async)]
fn open_download(app: AppHandle, manager: State<'_, Manager>, id: String) -> Result<(), String> {
    let (path, completed) = manager.path_of(&id).ok_or("download not found")?;
    if !completed {
        return Err("the download is not finished yet".into());
    }
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn reveal_download(app: AppHandle, manager: State<'_, Manager>, id: String) -> Result<(), String> {
    let (path, completed) = manager.path_of(&id).ok_or("download not found")?;
    if completed {
        app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())
    } else {
        let dir = path.parent().ok_or("no folder")?;
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
    }
}

/// Push changed rows to the UI: right away when the list or a status changes, every 400 ms while
/// something downloads. Between list changes only running downloads can move, so only they are read.
fn spawn_progress_loop(app: AppHandle, manager: Manager, resync: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        let mut last_version = 0;
        let mut sent: HashMap<String, DownloadView> = HashMap::new();
        loop {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(400)) => {}
                _ = manager.wait_for_change() => {
                    // let a burst of changes (a batch, pause all) land in one update
                    tokio::time::sleep(Duration::from_millis(16)).await;
                }
            }
            let full = resync.swap(false, Ordering::Relaxed);
            let version = manager.version();
            let listed = full || version != last_version;
            if !listed && !manager.has_active() {
                continue;
            }
            last_version = version;
            if full {
                sent.clear();
            }
            let rows = if listed { manager.snapshot(false) } else { manager.snapshot_running() };
            let mut removed = Vec::new();
            if listed {
                let ids: HashSet<&str> = rows.iter().map(|r| r.record.id.as_str()).collect();
                removed = sent.keys().filter(|k| !ids.contains(k.as_str())).cloned().collect();
                for id in &removed {
                    sent.remove(id);
                }
            }
            let mut upserts = Vec::new();
            for row in rows {
                if sent.get(&row.record.id) != Some(&row) {
                    sent.insert(row.record.id.clone(), row.clone());
                    upserts.push(row);
                }
            }
            if full || !upserts.is_empty() || !removed.is_empty() {
                let _ = app.emit("downloads-delta", Delta { full, upserts, removed });
            }
        }
    });
}

/// Offer copied links to downloadable files, like IDM's clipboard monitor.
fn spawn_clipboard_watcher(app: AppHandle, manager: Manager) {
    std::thread::spawn(move || {
        let Ok(mut clipboard) = arboard::Clipboard::new() else { return };
        let mut last = clipboard.get_text().unwrap_or_default();
        loop {
            std::thread::sleep(Duration::from_millis(800));
            let Ok(text) = clipboard.get_text() else { continue };
            if text == last {
                continue;
            }
            last = text;
            if manager.settings().monitor_clipboard && engine::naming::looks_like_download(&last) {
                let _ = app.emit("clipboard-url", last.trim().to_string());
            }
        }
    });
}

/// The app was called Fetchr before: carry its saved downloads and settings over once.
fn migrate_legacy_data(data_dir: &std::path::Path) {
    let current = data_dir.join("state.json");
    let legacy = data_dir.parent().map(|base| base.join("com.fetchr.app").join("state.json"));
    if let Some(legacy) = legacy.filter(|l| l.exists() && !current.exists()) {
        let _ = std::fs::copy(legacy, current);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // a second copy would load the same state file and overwrite the first one's progress:
        // bring the running window forward instead
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // a "New download" window closed without an answer keeps its download, paused for later
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event
                && let Some(id) = window.label().strip_prefix(CONFIRM_PREFIX)
            {
                let _ = window.state::<Manager>().confirm(id, Confirmation::default());
            }
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            migrate_legacy_data(&data_dir);
            let download_dir = app.path().download_dir().unwrap_or_else(|_| data_dir.join("Downloads"));
            let runtime = tauri::async_runtime::block_on(async { tokio::runtime::Handle::current() });
            let manager = Manager::new(data_dir.join("state.json"), download_dir, runtime);
            app.manage(manager.clone());
            let resync = Resync::default();
            spawn_progress_loop(app.handle().clone(), manager.clone(), resync.0.clone());
            app.manage(resync);

            // tell the UI about taken-over downloads; one that waits for the user gets its "New
            // download" window, the others flash the taskbar instead of stealing focus
            let handle = app.handle().clone();
            let on_captured: bridge::OnCaptured = Arc::new(move |id: &str, source: &str, waiting: bool| {
                let _ = handle.emit("browser-captured", Captured { id: id.into(), source: source.into(), waiting });
                if waiting {
                    open_confirm_window(&handle, id);
                } else if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
                }
            });
            let runtime = tauri::async_runtime::block_on(async { tokio::runtime::Handle::current() });
            let status = bridge::start(manager.clone(), &runtime, bridge::Hooks { on_captured, can_ask: true });
            app.manage(BridgeState(status));
            spawn_clipboard_watcher(app.handle().clone(), manager);

            // the window starts hidden and the UI shows it with its rows drawn (no blank flash);
            // should the UI never get there, show it anyway
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3));
                if let Some(window) = handle.get_webview_window("main")
                    && !window.is_visible().unwrap_or(true)
                {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            probe_url,
            add_download,
            add_downloads,
            sync_downloads,
            refresh_download,
            get_download,
            pause_downloads,
            resume_downloads,
            remove_downloads,
            confirm_download,
            disk_space,
            get_settings,
            save_settings,
            open_download,
            reveal_download,
            bridge_status,
            open_extension_folder,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // let connections write what they received; running downloads continue next start
            handle.state::<Manager>().shutdown(Duration::from_millis(1500));
        }
    });
}
