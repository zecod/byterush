//! The Chromium browsers installed on this computer, for the extension setup guide: which ones to
//! suggest, and opening their extensions page.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
pub struct Browser {
    /// "chrome", "edge", "brave", "vivaldi", "opera" or "chromium".
    pub id: &'static str,
    pub name: &'static str,
    /// The page where unpacked extensions are loaded.
    pub extensions_page: &'static str,
    #[serde(skip)]
    pub path: PathBuf,
}

struct Kind {
    id: &'static str,
    name: &'static str,
    extensions_page: &'static str,
    /// Where it installs, per system: paths relative to the bases below, or program names on PATH.
    windows: &'static [&'static str],
    macos: &'static [&'static str],
    linux: &'static [&'static str],
}

const KINDS: &[Kind] = &[
    Kind {
        id: "chrome",
        name: "Google Chrome",
        extensions_page: "chrome://extensions",
        windows: &[r"Google\Chrome\Application\chrome.exe"],
        macos: &["Google Chrome.app/Contents/MacOS/Google Chrome"],
        linux: &["google-chrome", "google-chrome-stable"],
    },
    Kind {
        id: "edge",
        name: "Microsoft Edge",
        extensions_page: "edge://extensions",
        windows: &[r"Microsoft\Edge\Application\msedge.exe"],
        macos: &["Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
        linux: &["microsoft-edge", "microsoft-edge-stable"],
    },
    Kind {
        id: "brave",
        name: "Brave",
        extensions_page: "brave://extensions",
        windows: &[r"BraveSoftware\Brave-Browser\Application\brave.exe"],
        macos: &["Brave Browser.app/Contents/MacOS/Brave Browser"],
        linux: &["brave-browser", "brave"],
    },
    Kind {
        id: "vivaldi",
        name: "Vivaldi",
        extensions_page: "vivaldi://extensions",
        windows: &[r"Vivaldi\Application\vivaldi.exe"],
        macos: &["Vivaldi.app/Contents/MacOS/Vivaldi"],
        linux: &["vivaldi", "vivaldi-stable"],
    },
    Kind {
        id: "opera",
        name: "Opera",
        extensions_page: "opera://extensions",
        windows: &[r"Programs\Opera\opera.exe", r"Opera\opera.exe"],
        macos: &["Opera.app/Contents/MacOS/Opera"],
        linux: &["opera"],
    },
    Kind {
        id: "chromium",
        name: "Chromium",
        extensions_page: "chrome://extensions",
        windows: &[r"Chromium\Application\chrome.exe"],
        macos: &["Chromium.app/Contents/MacOS/Chromium"],
        linux: &["chromium", "chromium-browser"],
    },
];

/// Where browsers install on Windows: per machine, and per user.
fn windows_bases() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].iter().filter_map(std::env::var_os).map(PathBuf::from).collect()
}

fn macos_bases() -> Vec<PathBuf> {
    let mut bases = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        bases.push(Path::new(&home).join("Applications"));
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

/// The supported browsers found on this computer, most common first.
pub fn installed() -> Vec<Browser> {
    KINDS
        .iter()
        .filter_map(|k| locate(k).map(|path| Browser { id: k.id, name: k.name, extensions_page: k.extensions_page, path }))
        .collect()
}

/// Open the browser's extensions page (in its running window when it is open already).
pub fn open_extensions_page(id: &str) -> Result<(), String> {
    let browser = installed().into_iter().find(|b| b.id == id).ok_or("that browser was not found on this computer")?;
    let mut child = std::process::Command::new(&browser.path)
        .arg(browser.extensions_page)
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", browser.name))?;
    // a running browser takes the page over and this process ends; collect it when it does
    std::thread::spawn(move || child.wait());
    Ok(())
}
