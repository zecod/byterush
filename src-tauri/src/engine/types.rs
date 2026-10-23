use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Queued,
    Connecting,
    Downloading,
    /// All bytes are in; the file is being flushed, rebuilt from its parts or moved into place.
    Finishing,
    Paused,
    Completed,
    Error,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    General,
    Compressed,
    Documents,
    Music,
    Programs,
    Video,
}

/// How a download's bytes are stored while it runs.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Layout {
    /// One preallocated (sparse) file that every connection writes into.
    #[default]
    Single,
    /// One file per segment, joined at the end ("rebuilding") — for file systems without sparse
    /// files (exFAT, FAT32), where a write far into a new file first zero-fills everything before it.
    Parts,
}

/// Progress of the last step after the download itself.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Finishing {
    pub stage: &'static str,
    pub done: u64,
    pub total: u64,
}

/// A byte range of the target file. `end` is exclusive; `u64::MAX` means "until the server stops"
/// (used when the size is unknown).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Segment {
    pub start: u64,
    pub end: u64,
    pub downloaded: u64,
    /// Runtime only: a connection currently owns this segment.
    #[serde(skip)]
    pub claimed: bool,
    /// Runtime only: how fast its connection is going, in bytes per second (0 = not measured yet).
    #[serde(skip)]
    pub rate: u64,
    /// Runtime only: when its connection last delivered data.
    #[serde(skip)]
    pub rate_at: Option<std::time::Instant>,
}

impl Segment {
    pub fn new(start: u64, end: u64) -> Self {
        Self { start, end, downloaded: 0, claimed: false, rate: 0, rate_at: None }
    }
    pub fn pos(&self) -> u64 {
        self.start + self.downloaded
    }
    pub fn remaining(&self) -> u64 {
        self.end.saturating_sub(self.pos())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub download_dir: String,
    /// Where partial files are kept while downloading; empty = next to the final file.
    pub temp_dir: String,
    pub category_subfolders: bool,
    pub connections: u8,
    pub max_active: u8,
    /// Global limit in KiB/s, 0 = unlimited.
    pub speed_limit_kbps: u64,
    pub monitor_clipboard: bool,
    /// Take over downloads handed over by the browser extension.
    pub browser_integration: bool,
    pub retries: u8,
    pub theme: String,
    /// Empty = the built-in one (see `app_user_agent`).
    pub user_agent: String,
    /// Continue the downloads that were running when the app closed (or crashed).
    pub resume_on_startup: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: String::new(),
            temp_dir: String::new(),
            category_subfolders: true,
            connections: 8,
            max_active: 3,
            speed_limit_kbps: 0,
            monitor_clipboard: true,
            browser_integration: true,
            retries: 5,
            theme: "system".into(),
            user_agent: String::new(),
            resume_on_startup: true,
        }
    }
}

impl Settings {
    /// The user-agent requests go out with when the browser didn't hand one over.
    pub fn effective_user_agent(&self) -> String {
        let custom = self.user_agent.trim();
        if custom.is_empty() { app_user_agent().to_string() } else { custom.to_string() }
    }
}

/// The app's own, honest user-agent. Measured against common download hosts it is the one that
/// works best: a browser-like value made SourceForge and VideoLAN answer with their "your download
/// will start" page instead of the file, and a Chrome one with a non-Chrome TLS handshake was cut
/// off as an impostor (Hetzner). Downloads taken over from the browser replay its own headers.
pub fn app_user_agent() -> &'static str {
    concat!("Byterush/", env!("CARGO_PKG_VERSION"), " (+https://github.com/zecod/byterush)")
}

/// Persisted state of one download.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Record {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub dir: String,
    pub category: Category,
    pub size: Option<u64>,
    pub resumable: bool,
    pub connections: u8,
    pub segments: Vec<Segment>,
    pub status: Status,
    pub error: Option<String>,
    pub added_at: u64,
    pub completed_at: Option<u64>,
    /// Partial file in use, kept so a changed temp folder doesn't orphan paused downloads.
    #[serde(default)]
    pub part_path: Option<String>,
    /// Browser request headers (cookies, user-agent, referer) replayed on every request so
    /// protected sites see the same session. Cleared once the download completes.
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub layout: Layout,
    /// What identifies this version of the file on the server (ETag and Last-Modified), so a resume
    /// never stitches together bytes of two different versions.
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
}

impl Record {
    pub fn downloaded(&self) -> u64 {
        self.segments.iter().map(|s| s.downloaded).sum()
    }

    /// What the UI gets: no segments, and the session headers never leave the engine.
    pub fn clone_without_segments(&self) -> Self {
        self.copy(Vec::new(), Vec::new())
    }

    /// A full copy (session headers included) carrying the given segments.
    pub fn with_segments(&self, segments: Vec<Segment>) -> Self {
        self.copy(segments, self.headers.clone())
    }

    fn copy(&self, segments: Vec<Segment>, headers: Vec<(String, String)>) -> Self {
        Self {
            id: self.id.clone(),
            url: self.url.clone(),
            file_name: self.file_name.clone(),
            dir: self.dir.clone(),
            category: self.category,
            size: self.size,
            resumable: self.resumable,
            connections: self.connections,
            segments,
            status: self.status,
            error: self.error.clone(),
            added_at: self.added_at,
            completed_at: self.completed_at,
            part_path: self.part_path.clone(),
            headers,
            layout: self.layout,
            etag: self.etag.clone(),
            last_modified: self.last_modified.clone(),
        }
    }
}

/// What the UI receives for each download. List rows leave `segments` empty; the details
/// panel asks for one download with its segments.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct DownloadView {
    #[serde(flatten)]
    pub record: Record,
    pub segment_count: usize,
    pub finishing: Option<Finishing>,
    pub downloaded: u64,
    pub speed: f64,
    pub eta: Option<f64>,
    pub active_connections: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProbeInfo {
    pub url: String,
    pub final_url: String,
    pub file_name: String,
    pub size: Option<u64>,
    pub resumable: bool,
    pub content_type: Option<String>,
    pub category: Category,
    pub dir: String,
    #[serde(skip)]
    pub etag: Option<String>,
    #[serde(skip)]
    pub last_modified: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct AddRequest {
    pub url: String,
    pub file_name: Option<String>,
    pub dir: Option<String>,
    pub connections: Option<u8>,
    /// Size from an earlier probe, shown until the download starts.
    pub size: Option<u64>,
    #[serde(default = "yes")]
    pub start: bool,
    /// Browser request headers to replay (see `Record::headers`).
    #[serde(default)]
    pub headers: Vec<(String, String)>,
}

/// What the browser saw for a download it handed over; the first response must match it.
#[derive(Clone, Debug, Default)]
pub struct Expectation {
    pub size: Option<u64>,
    pub mime: Option<String>,
}

fn yes() -> bool {
    true
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
