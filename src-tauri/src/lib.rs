pub mod bridge;
pub mod browsers;
pub mod engine;

use engine::{AddRequest, Confirmation, DiskSpace, DownloadView, Manager, ProbeInfo, Settings};
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
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

/// A download the browser kept because the app couldn't take it.
#[derive(Serialize, Clone)]
struct Declined {
    name: String,
    reason: String,
}

/// Label of the "New download" window.
const ASK_WINDOW: &str = "confirm";

/// Browser hand-overs waiting for the user. The "New download" window asks about one at a time:
/// `current` is the one it shows, `queue` the ones after it.
#[derive(Default)]
struct Asking {
    current: Option<String>,
    queue: VecDeque<String>,
}

type AskState = Mutex<Asking>;

#[tauri::command(async)]
fn bridge_status(state: State<'_, BridgeState>) -> bridge::BridgeStatus {
    state.0.lock().unwrap().clone()
}

/// The unpacked extension shipped with the app (repo folder in development). An AppImage's files
/// sit in a mount that moves on every start and is gone once the app quits, and the browser would
/// lose an extension loaded from there: an AppImage copies it to its data folder instead, refreshed
/// on every call so an updated app brings its extension along.
fn extension_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    let bundled = app.path().resource_dir().ok().map(|d| d.join("extension"));
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../extension");
    let found = [bundled, Some(dev)].into_iter().flatten().find(|d| d.join("manifest.json").exists())?;
    if std::env::var_os("APPIMAGE").is_none() {
        return Some(found);
    }
    let stable = app.path().app_data_dir().ok()?.join("extension");
    Some(if copy_dir(&found, &stable).is_ok() { stable } else { found })
}

fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// The extension folder as people know it: Windows' canonical form starts with `\\?\`.
fn shown_extension_dir(app: &AppHandle) -> Option<String> {
    let dir = extension_dir(app)?;
    let dir = dir.canonicalize().unwrap_or(dir);
    let text = dir.to_string_lossy();
    Some(text.strip_prefix(r"\\?\").unwrap_or(&text).to_string())
}

/// Where the extension's folder is, for the setup guide to show and copy.
#[tauri::command(async)]
fn extension_folder(app: AppHandle) -> Option<String> {
    shown_extension_dir(&app)
}

/// The browsers the extension can be installed in, found on this computer.
#[tauri::command(async)]
fn installed_browsers() -> Vec<browsers::Browser> {
    browsers::installed()
}

#[tauri::command(async)]
fn open_extensions_page(id: String) -> Result<(), String> {
    browsers::open_extensions_page(&id)
}

#[tauri::command(async)]
fn open_extension_folder(app: AppHandle) -> Result<String, String> {
    let shown = shown_extension_dir(&app).ok_or("extension folder not found")?;
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
fn remove_downloads(app: AppHandle, manager: State<'_, Manager>, ids: Vec<String>, delete_files: bool) {
    manager.remove(&ids, delete_files);
    for id in &ids {
        asked(&app, id);
    }
}

/// The answer from the "New download" window: start (which brings the main window forward with
/// the download in it, the way a download manager shows its progress) or keep it for later.
#[tauri::command(async)]
fn confirm_download(app: AppHandle, manager: State<'_, Manager>, id: String, choice: Confirmation) -> Result<String, String> {
    let start = choice.start;
    let file_name = manager.confirm(&id, choice)?;
    asked(&app, &id);
    if start && let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(file_name)
}

/// "Cancel" in the "New download" window: the download and anything it wrote are dropped.
#[tauri::command(async)]
fn cancel_download(app: AppHandle, manager: State<'_, Manager>, id: String) {
    manager.remove(std::slice::from_ref(&id), true);
    asked(&app, &id);
}

/// The download the "New download" window should show now, if any.
#[tauri::command(async)]
fn asking_now(asking: State<'_, AskState>) -> Option<String> {
    asking.lock().unwrap().current.clone()
}

/// Show the "New download" window again for a download waiting for an answer (from the main window).
#[tauri::command(async)]
fn ask_download(app: AppHandle, id: String) {
    ask(&app, &id, true);
}

#[tauri::command(async)]
fn disk_space(dir: String) -> Option<DiskSpace> {
    engine::disk_space(std::path::Path::new(&dir))
}

/// The "New download" window, IDM style: a small window on top of the browser with the file's
/// name, size, folder and the room left on that drive. It is created hidden when the app starts
/// and reused, so it shows at once (a new web view takes a second or more to start).
fn build_ask_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    tauri::WebviewWindowBuilder::new(app, ASK_WINDOW, tauri::WebviewUrl::default())
        .title("New download · Byterush")
        // its content's height (the font ships with the app, so it is the same everywhere). Not
        // "resizable(false)": on Linux that pins the window to a height GTK picks instead.
        .inner_size(620.0, 400.0)
        .min_inner_size(520.0, 360.0)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(false)
        .center()
        .visible(false)
        .build()
}

/// Ask the user about a download that waits for an answer (see `Manager::confirm`): show it in the
/// "New download" window now, or after the one shown there. `first` puts it before the others.
fn ask(app: &AppHandle, id: &str, first: bool) {
    let show = {
        let state = app.state::<AskState>();
        let mut asking = state.lock().unwrap();
        if asking.current.as_deref() == Some(id) {
            true
        } else {
            asking.queue.retain(|q| q != id);
            if first {
                asking.queue.push_front(id.to_string());
            } else {
                asking.queue.push_back(id.to_string());
            }
            asking.current.is_none()
        }
    };
    if show {
        show_next(app);
    }
}

/// Show the current download in the window, or move on to the next one waiting.
fn show_next(app: &AppHandle) {
    let id = {
        let state = app.state::<AskState>();
        let mut asking = state.lock().unwrap();
        if asking.current.is_none() {
            asking.current = asking.queue.pop_front();
        }
        asking.current.clone()
    };
    let Some(id) = id else {
        if let Some(window) = app.get_webview_window(ASK_WINDOW) {
            let _ = window.hide();
        }
        return;
    };
    // not made at startup yet, or that failed: make it now (it asks for the current one when loaded)
    let window = app.get_webview_window(ASK_WINDOW).or_else(|| build_ask_window(app).ok()).or_else(|| app.get_webview_window(ASK_WINDOW));
    match window {
        // the window loads the download, then shows itself; should its page fail to, show it anyway
        Some(window) => {
            let _ = window.emit_to(ASK_WINDOW, "ask", &id);
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1500));
                let still = app.state::<AskState>().lock().unwrap().current.as_deref() == Some(id.as_str());
                if still && !window.is_visible().unwrap_or(true) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });
        }
        // nowhere to ask: don't keep the download waiting
        None => {
            let _ = app.state::<Manager>().confirm(&id, Confirmation { start: true, ..Default::default() });
            asked(app, &id);
        }
    }
}

/// The user answered about `id` (or it is gone): ask about the next one, or hide the window.
fn asked(app: &AppHandle, id: &str) {
    let next = {
        let state = app.state::<AskState>();
        let mut asking = state.lock().unwrap();
        asking.queue.retain(|q| q != id);
        if asking.current.as_deref() != Some(id) {
            return;
        }
        asking.current = None;
        !asking.queue.is_empty()
    };
    if next {
        show_next(app);
    } else if let Some(window) = app.get_webview_window(ASK_WINDOW) {
        let _ = window.hide();
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
        // closing the "New download" window keeps its download, paused for later; the window itself
        // stays, hidden, for the next one
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == ASK_WINDOW
            {
                api.prevent_close();
                let app = window.app_handle();
                let current = app.state::<AskState>().lock().unwrap().current.clone();
                match current {
                    Some(id) => {
                        let _ = app.state::<Manager>().confirm(&id, Confirmation::default());
                        asked(app, &id);
                    }
                    None => {
                        let _ = window.hide();
                    }
                }
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
            app.manage(AskState::default());

            // tell the UI about taken-over downloads; one that waits for the user is shown in the "New
            // download" window, the others flash the taskbar instead of stealing focus. Off the
            // bridge's request, which answers the browser right away whatever the windows do.
            let handle = app.handle().clone();
            let on_captured: bridge::OnCaptured = Arc::new(move |id: &str, source: &str, waiting: bool| {
                let (handle, id) = (handle.clone(), id.to_string());
                let _ = handle.emit("browser-captured", Captured { id: id.clone(), source: source.into(), waiting });
                std::thread::spawn(move || {
                    if waiting {
                        ask(&handle, &id, false);
                    } else if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
                    }
                });
            });
            let runtime = tauri::async_runtime::block_on(async { tokio::runtime::Handle::current() });
            // and the ones the browser had to keep, so they don't go by unnoticed
            let handle = app.handle().clone();
            let on_declined: bridge::OnDeclined = Arc::new(move |name: &str, reason: &str| {
                let _ = handle.emit("browser-kept", Declined { name: name.into(), reason: reason.into() });
            });
            let hooks = bridge::Hooks { on_captured, on_declined, can_ask: true };
            let status = bridge::start(manager.clone(), &runtime, hooks);
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
            // the "New download" window starts in the background once the main one is up, so it
            // shows at once when the browser hands a download over
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1500));
                if handle.get_webview_window(ASK_WINDOW).is_none() {
                    let _ = build_ask_window(&handle);
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
            cancel_download,
            asking_now,
            ask_download,
            disk_space,
            get_settings,
            save_settings,
            open_download,
            reveal_download,
            bridge_status,
            open_extension_folder,
            extension_folder,
            installed_browsers,
            open_extensions_page,
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
