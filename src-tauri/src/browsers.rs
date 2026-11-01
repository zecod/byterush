//! The Chromium browsers installed on this computer, for the extension setup guide: which one is
//! the default, which ones to suggest, and opening a page (the store listing, the extensions page)
//! in one of them.
//!
//! Opening goes to the browser the user already runs, in the profile they used last, in a new
//! window: a running Chromium browser takes a second launch's command line over (and that second
//! process ends), so the page lands next to their extensions and sign-ins, not in a fresh profile.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
pub struct Browser {
    /// "chrome", "edge", "brave", "vivaldi", "opera", "chromium", or "other:<app name>" for a
    /// Chromium-based browser this list doesn't know by name (found as the default browser).
    pub id: String,
    pub name: String,
    /// The page where unpacked extensions are loaded.
    pub extensions_page: String,
    /// The system's default web browser.
    pub default: bool,
    #[serde(skip)]
    pub path: PathBuf,
    /// Where it keeps its profiles, to open the page in the last used one.
    #[serde(skip)]
    user_data: Option<PathBuf>,
}

struct Kind {
    id: &'static str,
    name: &'static str,
    extensions_page: &'static str,
    /// Where it installs, per system: paths relative to the bases below, or program names on PATH.
    windows: &'static [&'static str],
    macos: &'static [&'static str],
    linux: &'static [&'static str],
    /// Its profiles folder, per system: under %LOCALAPPDATA%, ~/Library/Application Support and
    /// ~/.config. Empty where it doesn't follow Chromium's layout.
    data_windows: &'static str,
    data_macos: &'static str,
    data_linux: &'static str,
    /// How the system names it as the default browser: Windows ProgId prefixes, macOS bundle ids
    /// (lowercase), and Linux .desktop names.
    progids: &'static [&'static str],
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    bundle_ids: &'static [&'static str],
    desktop: &'static [&'static str],
}

const KINDS: &[Kind] = &[
    Kind {
        id: "chrome",
        name: "Google Chrome",
        extensions_page: "chrome://extensions",
        windows: &[r"Google\Chrome\Application\chrome.exe"],
        macos: &["Google Chrome.app/Contents/MacOS/Google Chrome"],
        linux: &["google-chrome", "google-chrome-stable"],
        data_windows: r"Google\Chrome\User Data",
        data_macos: "Google/Chrome",
        data_linux: "google-chrome",
        progids: &["ChromeHTML"],
        bundle_ids: &["com.google.chrome"],
        desktop: &["google-chrome"],
    },
    Kind {
        id: "edge",
        name: "Microsoft Edge",
        extensions_page: "edge://extensions",
        windows: &[r"Microsoft\Edge\Application\msedge.exe"],
        macos: &["Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
        linux: &["microsoft-edge", "microsoft-edge-stable"],
        data_windows: r"Microsoft\Edge\User Data",
        data_macos: "Microsoft Edge",
        data_linux: "microsoft-edge",
        progids: &["MSEdgeHTM"],
        bundle_ids: &["com.microsoft.edgemac"],
        desktop: &["microsoft-edge"],
    },
    Kind {
        id: "brave",
        name: "Brave",
        extensions_page: "brave://extensions",
        windows: &[r"BraveSoftware\Brave-Browser\Application\brave.exe"],
        macos: &["Brave Browser.app/Contents/MacOS/Brave Browser"],
        linux: &["brave-browser", "brave"],
        data_windows: r"BraveSoftware\Brave-Browser\User Data",
        data_macos: "BraveSoftware/Brave-Browser",
        data_linux: "BraveSoftware/Brave-Browser",
        progids: &["BraveHTML"],
        bundle_ids: &["com.brave.browser"],
        desktop: &["brave-browser", "brave"],
    },
    Kind {
        id: "vivaldi",
        name: "Vivaldi",
        extensions_page: "vivaldi://extensions",
        windows: &[r"Vivaldi\Application\vivaldi.exe"],
        macos: &["Vivaldi.app/Contents/MacOS/Vivaldi"],
        linux: &["vivaldi", "vivaldi-stable"],
        data_windows: r"Vivaldi\User Data",
        data_macos: "Vivaldi",
        data_linux: "vivaldi",
        progids: &["VivaldiHTM"],
        bundle_ids: &["com.vivaldi.vivaldi"],
        desktop: &["vivaldi"],
    },
    Kind {
        id: "opera",
        name: "Opera",
        extensions_page: "opera://extensions",
        windows: &[r"Programs\Opera\opera.exe", r"Opera\opera.exe", r"Programs\Opera GX\opera.exe"],
        macos: &["Opera.app/Contents/MacOS/Opera", "Opera GX.app/Contents/MacOS/Opera"],
        linux: &["opera"],
        data_windows: "",
        data_macos: "",
        data_linux: "",
        progids: &["Opera"],
        bundle_ids: &["com.operasoftware.opera", "com.operasoftware.operagx"],
        desktop: &["opera"],
    },
    Kind {
        id: "chromium",
        name: "Chromium",
        extensions_page: "chrome://extensions",
        windows: &[r"Chromium\Application\chrome.exe"],
        macos: &["Chromium.app/Contents/MacOS/Chromium"],
        linux: &["chromium", "chromium-browser"],
        data_windows: r"Chromium\User Data",
        data_macos: "Chromium",
        data_linux: "chromium",
        progids: &["ChromiumHTM"],
        bundle_ids: &["org.chromium.chromium"],
        desktop: &["chromium"],
    },
];

/// Where browsers install on Windows: per machine, and per user.
fn windows_bases() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].iter().filter_map(std::env::var_os).map(PathBuf::from).collect()
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn macos_bases() -> Vec<PathBuf> {
    let mut bases = vec![PathBuf::from("/Applications")];
    if let Some(home) = home() {
        bases.push(home.join("Applications"));
    }
    bases
}

/// A program on PATH.
fn which(program: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?).map(|dir| dir.join(program)).find(|p| p.is_file())
}

fn locate(kind: &Kind) -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        windows_bases().iter().flat_map(|base| kind.windows.iter().map(move |rel| base.join(rel))).find(|p| p.is_file())
    } else if cfg!(target_os = "macos") {
        macos_bases().iter().flat_map(|base| kind.macos.iter().map(move |rel| base.join(rel))).find(|p| p.is_file())
    } else {
        kind.linux.iter().find_map(|program| which(program))
    }
}

fn user_data(kind: &Kind) -> Option<PathBuf> {
    let (base, rel) = if cfg!(target_os = "windows") {
        (std::env::var_os("LOCALAPPDATA").map(PathBuf::from), kind.data_windows)
    } else if cfg!(target_os = "macos") {
        (home().map(|h| h.join("Library/Application Support")), kind.data_macos)
    } else {
        (std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| home().map(|h| h.join(".config"))), kind.data_linux)
    };
    if rel.is_empty() {
        return None;
    }
    Some(base?.join(rel)).filter(|p| p.is_dir())
}

fn from_kind(kind: &Kind, path: PathBuf) -> Browser {
    Browser {
        id: kind.id.into(),
        name: kind.name.into(),
        extensions_page: kind.extensions_page.into(),
        default: false,
        path,
        user_data: user_data(kind),
    }
}

/// What the system opens web links with, as the system names it: a Windows ProgId, a macOS app
/// bundle, or a Linux .desktop file name.
#[allow(dead_code)] // each system builds one of them
enum DefaultHandler {
    ProgId(String),
    App(PathBuf),
    Desktop(String),
}

#[cfg(target_os = "macos")]
fn default_handler() -> Option<DefaultHandler> {
    macos::default_https_app().map(DefaultHandler::App)
}

#[cfg(target_os = "windows")]
fn default_handler() -> Option<DefaultHandler> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice", "/v", "ProgId"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    // "    ProgId    REG_SZ    ChromeHTML"
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().find(|l| l.contains("REG_SZ"))?;
    Some(DefaultHandler::ProgId(line.split("REG_SZ").nth(1)?.trim().to_string()))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn default_handler() -> Option<DefaultHandler> {
    let out = std::process::Command::new("xdg-settings").args(["get", "default-web-browser"]).output().ok()?;
    let name = String::from_utf8_lossy(&out.stdout).trim().trim_end_matches(".desktop").to_lowercase();
    (!name.is_empty()).then_some(DefaultHandler::Desktop(name))
}

/// The installed browser the default handler is, or, for a Chromium-based browser this list
/// doesn't know (Arc, Helium, Thorium…), that browser on its own.
fn default_browser(installed: &[Browser]) -> Option<Browser> {
    let kind = match default_handler()? {
        DefaultHandler::ProgId(progid) => KINDS.iter().find(|k| k.progids.iter().any(|p| progid.starts_with(p))),
        DefaultHandler::Desktop(name) => KINDS.iter().find(|k| k.desktop.iter().any(|d| name == *d || name.starts_with(&format!("{d}-")))),
        DefaultHandler::App(app) => {
            #[cfg(target_os = "macos")]
            {
                let bundle_id = macos::info(&app, "CFBundleIdentifier").unwrap_or_default().to_lowercase();
                match KINDS.iter().find(|k| k.bundle_ids.contains(&bundle_id.as_str())) {
                    Some(kind) => Some(kind),
                    None => return macos::other_chromium(&app),
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = app;
                None
            }
        }
    }?;
    installed.iter().find(|b| b.id == kind.id).cloned()
}

/// The supported browsers found on this computer, the default one first (marked), then the most
/// common ones.
pub fn installed() -> Vec<Browser> {
    let mut found: Vec<Browser> = KINDS.iter().filter_map(|k| locate(k).map(|path| from_kind(k, path))).collect();
    if let Some(mut default) = default_browser(&found) {
        found.retain(|b| b.id != default.id);
        default.default = true;
        found.insert(0, default);
    }
    found
}

/// The profile the user had open last ("Default", "Profile 1"…), from the browser's Local State.
fn last_profile(user_data: &Path) -> Option<String> {
    let text = std::fs::read_to_string(user_data.join("Local State")).ok()?;
    let state: serde_json::Value = serde_json::from_str(&text).ok()?;
    let last = state.pointer("/profile/last_used").and_then(|v| v.as_str()).unwrap_or("Default");
    user_data.join(last).is_dir().then(|| last.to_string())
}

/// Whether the browser runs now (macOS only needs to know: see `open_in`).
#[cfg(target_os = "macos")]
fn running(browser: &Browser) -> bool {
    let Ok(out) = std::process::Command::new("ps").args(["-axo", "command="]).output() else { return false };
    let exe = browser.path.to_string_lossy();
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .any(|line| line.strip_prefix(exe.as_ref()).is_some_and(|rest| rest.is_empty() || rest.starts_with(' ')))
}

/// Open `url` in the browser: in a new window of the copy already running, in the profile used
/// last, or by starting the browser when it isn't running.
fn open_in(browser: &Browser, url: &str) -> Result<(), String> {
    let mut args = Vec::new();
    if let Some(profile) = browser.user_data.as_deref().and_then(last_profile) {
        // without it a browser set to show its profile picker shows that instead of the page
        args.push(format!("--profile-directory={profile}"));
    }
    args.push("--new-window".into());
    args.push(url.into());

    #[cfg(target_os = "macos")]
    if !running(browser) {
        // started through Launch Services, as from the Dock: started directly it would be this
        // app's child process
        let app = browser.path.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")).ok_or("app bundle not found")?;
        let status = std::process::Command::new("open")
            .arg("-a")
            .arg(app)
            .arg("--args")
            .args(&args)
            .status()
            .map_err(|e| format!("could not start {}: {e}", browser.name))?;
        return if status.success() { Ok(()) } else { Err(format!("could not start {}", browser.name)) };
    }
    #[cfg(target_os = "macos")]
    if !url.starts_with("https://") {
        // a running browser opens its own pages (chrome://extensions) only when asked from inside
        // it: one handed over on the command line becomes an empty new tab. Its AppleScript
        // (Chrome's, which Brave, Edge, Vivaldi and Chromium share) opens it in a new window.
        return macos::open_in_new_window(browser, url);
    }

    let mut command = std::process::Command::new(&browser.path);
    command.args(&args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        command.creation_flags(DETACHED_PROCESS);
    }
    let mut child = command.spawn().map_err(|e| format!("could not start {}: {e}", browser.name))?;
    // a running browser takes the page over and this process ends; collect it when it does
    std::thread::spawn(move || child.wait());
    Ok(())
}

fn find(id: &str) -> Result<Browser, String> {
    installed().into_iter().find(|b| b.id == id).ok_or_else(|| "that browser was not found on this computer".into())
}

/// Open the browser's extensions page.
pub fn open_extensions_page(id: &str) -> Result<(), String> {
    let browser = find(id)?;
    open_in(&browser, &browser.extensions_page)
}

/// Open a web page (the store listing) in that browser.
pub fn open_page(id: &str, url: &str) -> Result<(), String> {
    // a web address only: it goes on the browser's command line
    if !url.starts_with("https://") {
        return Err("not a web address".into());
    }
    open_in(&find(id)?, url)
}

#[cfg(target_os = "macos")]
mod macos {
    use super::Browser;
    use std::ffi::c_void;
    use std::path::{Path, PathBuf};

    type CFTypeRef = *const c_void;
    type CFAllocatorRef = *const c_void;
    type CFURLRef = *const c_void;
    type CFIndex = isize;
    const UTF8: u32 = 0x0800_0100;
    const ROLES_ALL: u32 = 0xFFFF_FFFF;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFURLCreateWithBytes(alloc: CFAllocatorRef, bytes: *const u8, len: CFIndex, encoding: u32, base: CFURLRef) -> CFURLRef;
        fn CFURLGetFileSystemRepresentation(url: CFURLRef, resolve: u8, buffer: *mut u8, max: CFIndex) -> u8;
        fn CFRelease(cf: CFTypeRef);
    }

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn LSCopyDefaultApplicationURLForURL(url: CFURLRef, roles: u32, error: *mut CFTypeRef) -> CFURLRef;
    }

    /// The app bundle macOS opens https links with.
    pub fn default_https_app() -> Option<PathBuf> {
        let link = b"https://byterush.xyz/";
        unsafe {
            let url = CFURLCreateWithBytes(std::ptr::null(), link.as_ptr(), link.len() as CFIndex, UTF8, std::ptr::null());
            if url.is_null() {
                return None;
            }
            let app = LSCopyDefaultApplicationURLForURL(url, ROLES_ALL, std::ptr::null_mut());
            CFRelease(url);
            if app.is_null() {
                return None;
            }
            let mut buf = [0u8; 4096];
            let ok = CFURLGetFileSystemRepresentation(app, 1, buf.as_mut_ptr(), buf.len() as CFIndex);
            CFRelease(app);
            if ok == 0 {
                return None;
            }
            let len = buf.iter().position(|&b| b == 0)?;
            Some(PathBuf::from(String::from_utf8_lossy(&buf[..len]).into_owned()))
        }
    }

    /// A value from the app's Info.plist.
    pub fn info(app: &Path, key: &str) -> Option<String> {
        let out = std::process::Command::new("plutil")
            .args(["-extract", key, "raw", "-o", "-"])
            .arg(app.join("Contents/Info.plist"))
            .output()
            .ok()?;
        let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (out.status.success() && !value.is_empty()).then_some(value)
    }

    /// A Chromium-based browser the list doesn't know: its frameworks carry Chromium's resource
    /// packs.
    fn is_chromium(app: &Path) -> bool {
        let Ok(entries) = std::fs::read_dir(app.join("Contents/Frameworks")) else { return false };
        entries.flatten().any(|e| {
            let fw = e.path();
            ["Versions/Current/Resources/chrome_100_percent.pak", "Resources/chrome_100_percent.pak"]
                .iter()
                .any(|rel| fw.join(rel).is_file())
        })
    }

    /// Open `url` in a new window of the running browser, through its AppleScript. The first time,
    /// macOS asks whether Byterush may control that browser (NSAppleEventsUsageDescription).
    pub fn open_in_new_window(browser: &Browser, url: &str) -> Result<(), String> {
        let app = browser.path.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")).ok_or("app bundle not found")?;
        let id = info(app, "CFBundleIdentifier").ok_or("app bundle not found")?;
        if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
            return Err("unexpected app bundle id".into());
        }
        let script = format!(
            "on run argv\n tell application id \"{id}\"\n  make new window\n  set URL of active tab of front window to (item 1 of argv)\n  activate\n end tell\nend run"
        );
        let out = std::process::Command::new("osascript")
            .args(["-e", &script, url])
            .output()
            .map_err(|e| format!("could not reach {}: {e}", browser.name))?;
        if out.status.success() {
            return Ok(());
        }
        let err = String::from_utf8_lossy(&out.stderr);
        Err(if err.contains("-1743") {
            format!(
                "byterush may not control {0}: allow it in System Settings → Privacy & Security → Automation, or type {1} in {0}'s address bar",
                browser.name, browser.extensions_page
            )
        } else {
            format!("could not open {} in {}: type it in the address bar", browser.extensions_page, browser.name)
        })
    }

    pub fn other_chromium(app: &Path) -> Option<Browser> {
        if !is_chromium(app) {
            return None;
        }
        let exe = app.join("Contents/MacOS").join(info(app, "CFBundleExecutable")?);
        let name = info(app, "CFBundleDisplayName")
            .or_else(|| info(app, "CFBundleName"))
            .or_else(|| app.file_stem().map(|s| s.to_string_lossy().into_owned()))?;
        exe.is_file().then(|| Browser {
            id: format!("other:{name}"),
            name,
            extensions_page: "chrome://extensions".into(),
            default: false,
            path: exe,
            user_data: None,
        })
    }
}
