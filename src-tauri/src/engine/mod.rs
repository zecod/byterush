//! Download engine: queue, persistence and lifecycle. Independent of Tauri so it can be tested.

mod download;
mod limiter;
pub mod naming;
mod segments;
pub mod types;

pub use download::HttpStatus;
use futures_util::StreamExt;
use limiter::Limiter;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, Weak};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;
pub use types::*;

/// Changes are written at most this often: a burst (a batch finishing, a queue starting) costs one write.
const SAVE_DELAY: Duration = Duration::from_millis(300);

/// What a running download needs from the manager.
#[derive(Clone)]
pub(crate) struct Ctx {
    client: reqwest::Client,
    limiter: Arc<Limiter>,
    retries: u32,
    temp_dir: Option<PathBuf>,
    saver: Arc<Saver>,
}

impl Ctx {
    fn retries(&self) -> u32 {
        self.retries
    }
}

pub(crate) struct Job {
    pub rec: Mutex<Record>,
    pub rt: Mutex<Runtime>,
}

impl Job {
    fn new(rec: Record) -> Self {
        Self { rec: Mutex::new(rec), rt: Mutex::new(Runtime::default()) }
    }

    /// Mark the download as running; `None` if it already is.
    fn begin(&self, running: &AtomicUsize) -> Option<CancellationToken> {
        let mut rt = self.rt.lock().unwrap();
        if rt.cancel.is_some() {
            return None;
        }
        let token = CancellationToken::new();
        rt.cancel = Some(token.clone());
        running.fetch_add(1, Ordering::SeqCst);
        Some(token)
    }

    fn is_running(&self) -> bool {
        self.rt.lock().unwrap().cancel.is_some()
    }

    /// What goes to disk. For a running download that is the progress last confirmed on disk, so the
    /// state never claims bytes a crash or power cut could still take away.
    fn stored(&self) -> Record {
        let persisted = self.rt.lock().unwrap().persisted.clone();
        let r = self.rec.lock().unwrap();
        match persisted {
            Some(segments) => r.with_segments(segments),
            None => r.clone(),
        }
    }
}

/// Reports whether a download's first response matched what the browser was getting.
type VerdictSender = tokio::sync::oneshot::Sender<Result<(), String>>;
pub type Verdict = tokio::sync::oneshot::Receiver<Result<(), String>>;

#[derive(Default)]
pub(crate) struct Runtime {
    cancel: Option<CancellationToken>,
    pub verdict: Option<(VerdictSender, Expectation)>,
    pub active: usize,
    removed: bool,
    meter_bytes: u64,
    meter_at: Option<Instant>,
    speed: f64,
    pub finishing: Option<Finishing>,
    /// Smoothed time from sending a range request to its first response, in seconds.
    pub request_latency: f64,
    /// Segments as of the last sync of the part file (see `Job::stored`).
    pub persisted: Option<Vec<Segment>>,
    /// Set while a download waits for the user's answer (`Status::Waiting`); `confirm` wakes it.
    pub confirm: Option<Arc<tokio::sync::Notify>>,
}

/// Wakes the thread that writes the state file.
pub(crate) struct Saver {
    dirty: Mutex<bool>,
    wake: Condvar,
}

impl Saver {
    pub(crate) fn mark(&self) {
        *self.dirty.lock().unwrap() = true;
        self.wake.notify_one();
    }
}

#[derive(Clone)]
pub struct Manager {
    inner: Arc<Inner>,
}

struct Inner {
    state: Mutex<State>,
    limiter: Arc<Limiter>,
    store_path: PathBuf,
    runtime: tokio::runtime::Handle,
    version: AtomicU64,
    /// Downloads with live connections.
    running: AtomicUsize,
    saver: Arc<Saver>,
    /// One writer of the state file at a time.
    save_lock: Mutex<()>,
    /// Wakes whoever pushes updates to the UI.
    changes: tokio::sync::Notify,
    /// The app is quitting: downloads stopped now continue on the next start.
    closing: AtomicBool,
}

struct State {
    settings: Settings,
    client: reqwest::Client,
    jobs: Vec<Arc<Job>>,
    /// Strictly increasing `added_at`, so a batch keeps its order in the list.
    last_added: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct Stored {
    #[serde(default)]
    settings: Settings,
    #[serde(default)]
    downloads: Vec<Record>,
}

/// A link ready to be added: name and size settled, nothing locked yet.
struct Prepared {
    url: String,
    file_name: String,
    size: Option<u64>,
    dir: Option<PathBuf>,
    connections: Option<u8>,
    start: bool,
    headers: Vec<(String, String)>,
    confirm: bool,
}

/// The address a download had before the browser handed over a fresh one (see `Manager::adopt`).
pub struct Previous {
    url: String,
    headers: Vec<(String, String)>,
    etag: Option<String>,
    last_modified: Option<String>,
}

fn build_client(user_agent: &str) -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(user_agent)
        // one TCP connection per segment, like a classic download accelerator
        .http1_only()
        .tcp_nodelay(true)
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(30))
        .build()
        .expect("http client")
}

fn err_string(e: anyhow::Error) -> String {
    err_string_ref(&e)
}

fn err_string_ref(e: &anyhow::Error) -> String {
    format!("{e:#}")
}

impl Manager {
    pub fn new(store_path: PathBuf, default_dir: PathBuf, runtime: tokio::runtime::Handle) -> Self {
        let stored = load_store(&store_path);
        let mut settings = stored.settings;
        if settings.download_dir.is_empty() {
            settings.download_dir = default_dir.to_string_lossy().into_owned();
        }
        // the built-in user-agent of earlier versions posed as a browser, which gets some sites'
        // "your download will start" page instead of the file; the built-in one now follows the app
        if settings.user_agent.contains("Fetchr/") || settings.user_agent.contains("Byterush/") {
            settings.user_agent.clear();
        }
        let resume = settings.resume_on_startup;
        let jobs: Vec<Arc<Job>> = stored
            .downloads
            .into_iter()
            .map(|mut rec| {
                // running when the app closed (or crashed): carry on, unless the user starts them by hand
                if matches!(rec.status, Status::Queued | Status::Connecting | Status::Downloading | Status::Finishing) {
                    rec.status = if resume { Status::Queued } else { Status::Paused };
                }
                // never confirmed: it waits for the user, not for the next start
                if rec.status == Status::Waiting {
                    rec.status = Status::Paused;
                }
                Arc::new(Job::new(rec))
            })
            .collect();
        let limiter = Arc::new(Limiter::new(settings.speed_limit_kbps * 1024));
        let client = build_client(&settings.effective_user_agent());
        let last_added = jobs.iter().map(|j| j.rec.lock().unwrap().added_at).max().unwrap_or(0);
        let saver = Arc::new(Saver { dirty: Mutex::new(false), wake: Condvar::new() });
        let manager = Self {
            inner: Arc::new(Inner {
                state: Mutex::new(State { settings, client, jobs, last_added }),
                limiter,
                store_path,
                runtime,
                version: AtomicU64::new(1),
                running: AtomicUsize::new(0),
                saver: saver.clone(),
                save_lock: Mutex::new(()),
                changes: tokio::sync::Notify::new(),
                closing: AtomicBool::new(false),
            }),
        };
        spawn_saver(Arc::downgrade(&manager.inner), saver);
        manager.inner.pump();
        manager
    }

    pub fn settings(&self) -> Settings {
        self.inner.state.lock().unwrap().settings.clone()
    }

    pub fn update_settings(&self, mut settings: Settings) {
        {
            let mut st = self.inner.state.lock().unwrap();
            if settings.download_dir.trim().is_empty() {
                settings.download_dir = st.settings.download_dir.clone();
            }
            settings.connections = settings.connections.clamp(1, 32);
            settings.max_active = settings.max_active.clamp(1, 20);
            settings.user_agent = settings.user_agent.trim().to_string();
            if settings.effective_user_agent() != st.settings.effective_user_agent() {
                st.client = build_client(&settings.effective_user_agent());
            }
            self.inner.limiter.set_rate(settings.speed_limit_kbps * 1024);
            st.settings = settings;
        }
        self.inner.changed();
        self.inner.pump();
    }

    pub async fn probe(&self, url: &str) -> Result<ProbeInfo, String> {
        self.probe_with(url, &[]).await
    }

    async fn probe_with(&self, url: &str, headers: &[(String, String)]) -> Result<ProbeInfo, String> {
        let (client, settings) = {
            let st = self.inner.state.lock().unwrap();
            (st.client.clone(), st.settings.clone())
        };
        let p = download::probe(&client, url.trim(), headers).await.map_err(err_string)?;
        let category = naming::category_for(&p.file_name);
        Ok(ProbeInfo {
            url: url.trim().to_string(),
            final_url: p.final_url.to_string(),
            dir: default_dir(&settings, category).to_string_lossy().into_owned(),
            file_name: p.file_name,
            size: p.size,
            resumable: p.resumable,
            content_type: p.content_type,
            category,
            etag: p.validators.etag,
            last_modified: p.validators.last_modified,
        })
    }

    pub async fn add(&self, req: AddRequest) -> Result<String, String> {
        let prepared = self.prepare(req).await?;
        let id = {
            let mut st = self.inner.state.lock().unwrap();
            let mut reserved = reserved_paths(&st);
            insert(&mut st, &mut reserved, prepared, None)
        };
        self.inner.changed();
        self.inner.pump();
        Ok(id)
    }

    /// Add many links with a single lock and a single save. Names come from the URL when possible;
    /// links that need a request for their name are checked a few at a time. Returns the new ids
    /// and per-link errors.
    pub async fn add_many(&self, requests: Vec<AddRequest>) -> (Vec<String>, Vec<String>) {
        let prepared: Vec<(String, Result<Prepared, String>)> = futures_util::stream::iter(requests)
            .map(|req| async move {
                let url = req.url.clone();
                (url, self.prepare(req).await)
            })
            .buffered(8)
            .collect()
            .await;
        let mut ids = Vec::new();
        let mut errors = Vec::new();
        {
            let mut st = self.inner.state.lock().unwrap();
            let mut reserved = reserved_paths(&st);
            for (url, p) in prepared {
                match p {
                    Ok(p) => ids.push(insert(&mut st, &mut reserved, p, None)),
                    Err(e) => errors.push(format!("{url}: {e}")),
                }
            }
        }
        self.inner.changed();
        self.inner.pump();
        (ids, errors)
    }

    /// Settle a link's name and size: from the request, the URL, or (last resort) a request.
    async fn prepare(&self, req: AddRequest) -> Result<Prepared, String> {
        let url = req.url.trim().to_string();
        let parsed = url::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("only http and https links can be downloaded".into());
        }
        let given = req.file_name.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(naming::sanitize);
        let from_url = naming::from_url(&parsed).filter(|n| naming::extension(n).is_some()).map(|n| naming::sanitize(&n));
        let (file_name, size) = match given.or(from_url) {
            Some(name) => (name, req.size),
            None => {
                let p = self.probe_with(&url, &req.headers).await?;
                (p.file_name, p.size)
            }
        };
        Ok(Prepared {
            url,
            file_name,
            size,
            dir: req.dir.as_deref().map(str::trim).filter(|d| !d.is_empty()).map(PathBuf::from),
            connections: req.connections,
            start: req.start,
            headers: req.headers.into_iter().filter(|(k, _)| download::forwardable(k)).collect(),
            confirm: req.confirm,
        })
    }

    /// Add a download handed over by the browser and start it right away, outside the queue.
    /// The receiver reports whether the first response is the file the browser was getting.
    pub async fn add_watched(&self, req: AddRequest, expect: Expectation) -> Result<(String, Verdict), String> {
        let prepared = self.prepare(AddRequest { start: true, ..req }).await?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        let (id, job) = {
            let mut st = self.inner.state.lock().unwrap();
            let mut reserved = reserved_paths(&st);
            // the verdict is in place before the queue can see the job
            let id = insert(&mut st, &mut reserved, prepared, Some((tx, expect)));
            (id, st.jobs.last().cloned())
        };
        self.inner.changed();
        if let Some(job) = job {
            self.inner.start_now(&job);
        }
        Ok((id, rx))
    }

    /// An unfinished download of the same file (same name and size) that isn't running: typically
    /// one whose link expired. A fresh link from the browser can continue it instead of starting over.
    pub fn find_resumable(&self, file_name: &str, size: u64) -> Option<String> {
        if size == 0 || file_name.trim().is_empty() {
            return None;
        }
        let st = self.inner.state.lock().unwrap();
        st.jobs.iter().find_map(|j| {
            let r = j.rec.lock().unwrap();
            let fits = matches!(r.status, Status::Paused | Status::Error)
                && r.resumable
                && r.size == Some(size)
                && naming::same_file(file_name, &r.file_name)
                && !j.is_running();
            fits.then(|| r.id.clone())
        })
    }

    /// Continue a paused or failed download from a new address handed over by the browser. Its
    /// first response is checked like a new hand-over; `restore` undoes the switch when it isn't
    /// the same file.
    pub fn adopt(&self, id: &str, url: String, headers: Vec<(String, String)>, expect: Expectation) -> Option<(Verdict, Previous)> {
        let job = self.inner.find(&[id.to_string()]).pop()?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut rt = job.rt.lock().unwrap();
            if rt.cancel.is_some() {
                return None;
            }
            rt.verdict = Some((tx, expect));
        }
        let previous = {
            let mut r = job.rec.lock().unwrap();
            let headers = headers.into_iter().filter(|(k, _)| download::forwardable(k)).collect();
            r.status = Status::Queued;
            r.error = None;
            // a fresh link often leads to another server whose ETag differs for the same file
            Previous {
                url: std::mem::replace(&mut r.url, url),
                headers: std::mem::replace(&mut r.headers, headers),
                etag: r.etag.take(),
                last_modified: r.last_modified.take(),
            }
        };
        self.inner.changed();
        self.inner.start_now(&job);
        Some((rx, previous))
    }

    /// Stop the attempt `adopt` started and put back the address the download had, showing why.
    pub fn restore(&self, id: &str, previous: Previous, reason: String) {
        if let Some(job) = self.inner.find(&[id.to_string()]).pop() {
            let token = job.rt.lock().unwrap().cancel.clone();
            if let Some(t) = token {
                t.cancel();
            }
            let mut r = job.rec.lock().unwrap();
            r.url = previous.url;
            r.headers = previous.headers;
            r.etag = previous.etag;
            r.last_modified = previous.last_modified;
            r.status = Status::Error;
            r.error = Some(reason);
        }
        self.inner.changed();
    }

    /// Point an unfinished download at a new address (a link that expired, copied again) and
    /// continue it. The new address must serve a file of the same size.
    pub async fn refresh(&self, id: &str, url: &str) -> Result<(), String> {
        let job = self.inner.find(&[id.to_string()]).pop().ok_or("download not found")?;
        let new = url::Url::parse(url.trim()).map_err(|e| format!("invalid URL: {e}"))?;
        if !matches!(new.scheme(), "http" | "https") {
            return Err("only http and https links can be downloaded".into());
        }
        let (size, old_url, headers, status) = {
            let r = job.rec.lock().unwrap();
            (r.size, r.url.clone(), r.headers.clone(), r.status)
        };
        if status == Status::Completed {
            return Err("this download is already complete".into());
        }
        if job.is_running() {
            return Err("pause the download first".into());
        }
        // the browser session belongs to the old site; keep it only for the same host
        let same_host = url::Url::parse(&old_url).ok().is_some_and(|u| u.host_str() == new.host_str());
        let headers = if same_host { headers } else { Vec::new() };
        let p = self.probe_with(new.as_str(), &headers).await?;
        if p.content_type.as_deref().is_some_and(|t| t.trim().to_ascii_lowercase().starts_with("text/html"))
            && !naming::extension(&job.rec.lock().unwrap().file_name).is_some_and(|e| e.starts_with("htm"))
        {
            return Err("the new link opens a web page, not the file".into());
        }
        if let (Some(want), Some(got)) = (size, p.size)
            && want != got
        {
            return Err(format!("the new link is a different file ({got} bytes instead of {want})"));
        }
        {
            let mut r = job.rec.lock().unwrap();
            r.url = new.to_string();
            r.headers = headers;
            r.etag = p.etag;
            r.last_modified = p.last_modified;
            r.error = None;
            r.status = Status::Queued;
        }
        self.inner.changed();
        self.inner.pump();
        Ok(())
    }

    pub fn browser_integration(&self) -> bool {
        self.inner.state.lock().unwrap().settings.browser_integration
    }

    /// Apply the user's answer to a download waiting in the "New download" window: its name,
    /// folder and connections, then start it or keep it paused for later. Returns the file name it
    /// got, which gains a " (1)" when the folder already has that name.
    pub fn confirm(&self, id: &str, choice: Confirmation) -> Result<String, String> {
        let job = self.inner.find(&[id.to_string()]).pop().ok_or("the download is gone")?;
        let hold = job.rt.lock().unwrap().confirm.take().ok_or("the download is not waiting for an answer")?;
        let file_name = {
            let st = self.inner.state.lock().unwrap();
            let mut reserved = reserved_paths(&st);
            let mut r = job.rec.lock().unwrap();
            reserved.remove(&PathBuf::from(&r.dir).join(&r.file_name));
            let name = choice.file_name.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(naming::sanitize);
            let dir = choice.dir.as_deref().map(str::trim).filter(|d| !d.is_empty()).map(PathBuf::from);
            let dir = dir.unwrap_or_else(|| PathBuf::from(&r.dir));
            let path = naming::unique_path(&dir, name.as_deref().unwrap_or(&r.file_name), &reserved);
            r.file_name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| r.file_name.clone());
            r.dir = dir.to_string_lossy().into_owned();
            r.category = naming::category_for(&r.file_name);
            if let Some(n) = choice.connections {
                r.connections = n.clamp(1, 32);
            }
            r.file_name.clone()
        };
        if choice.start {
            hold.notify_one();
            // paused from the main window in the meantime: it goes now
            self.resume(&[id.to_string()]);
        } else {
            self.pause(&[id.to_string()]);
        }
        Ok(file_name)
    }

    pub fn pause(&self, ids: &[String]) {
        for job in self.inner.find(ids) {
            let token = job.rt.lock().unwrap().cancel.clone();
            if let Some(t) = &token {
                t.cancel();
            }
            // show the pause right away; the connections wind down in the background
            let mut r = job.rec.lock().unwrap();
            if matches!(r.status, Status::Queued | Status::Connecting | Status::Waiting | Status::Downloading) {
                r.status = Status::Paused;
            }
        }
        self.inner.changed();
    }

    pub fn resume(&self, ids: &[String]) {
        for job in self.inner.find(ids) {
            // a paused download may still be winding down; queue it so it restarts right after
            let running = job.rt.lock().unwrap().cancel.as_ref().is_some_and(|t| !t.is_cancelled());
            if running {
                continue;
            }
            let mut r = job.rec.lock().unwrap();
            if matches!(r.status, Status::Paused | Status::Error) {
                r.status = Status::Queued;
                r.error = None;
            }
        }
        self.inner.changed();
        self.inner.pump();
    }

    pub fn remove(&self, ids: &[String], delete_files: bool) {
        let ids: HashSet<&String> = ids.iter().collect();
        let removed: Vec<Arc<Job>> = {
            let mut st = self.inner.state.lock().unwrap();
            let (gone, keep): (Vec<_>, Vec<_>) = st.jobs.drain(..).partition(|j| ids.contains(&j.rec.lock().unwrap().id));
            st.jobs = keep;
            gone
        };
        for job in &removed {
            let token = {
                let mut rt = job.rt.lock().unwrap();
                rt.removed = true;
                rt.cancel.clone()
            };
            if let Some(t) = token {
                t.cancel();
            }
        }
        if delete_files {
            self.inner.runtime.spawn(async move {
                for job in removed {
                    // the part file stays open until the connections stop
                    for _ in 0..100 {
                        if job.rt.lock().unwrap().cancel.is_none() {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                    let (target, part, completed) = {
                        let r = job.rec.lock().unwrap();
                        let target = PathBuf::from(&r.dir).join(&r.file_name);
                        let part = r.part_path.as_deref().map(PathBuf::from).unwrap_or_else(|| naming::part_path(&target));
                        (target, part, r.status == Status::Completed)
                    };
                    download::remove_part_files(&part);
                    let _ = std::fs::remove_file(naming::staging_path(&target));
                    if completed {
                        let _ = std::fs::remove_file(&target);
                    }
                }
            });
        }
        self.inner.changed();
        self.inner.pump();
    }

    /// Final file when complete, otherwise the folder it will land in.
    pub fn path_of(&self, id: &str) -> Option<(PathBuf, bool)> {
        let job = self.inner.find(&[id.to_string()]).into_iter().next()?;
        let r = job.rec.lock().unwrap();
        let target = PathBuf::from(&r.dir).join(&r.file_name);
        Some((target, r.status == Status::Completed))
    }

    /// One download including its segments (for the details panel).
    pub fn get(&self, id: &str) -> Option<DownloadView> {
        let job = self.inner.find(&[id.to_string()]).pop()?;
        Some(view(&job, true, Instant::now()))
    }

    /// Every download; `with_segments: false` keeps list payloads small.
    pub fn snapshot(&self, with_segments: bool) -> Vec<DownloadView> {
        let jobs = self.inner.state.lock().unwrap().jobs.clone();
        let now = Instant::now();
        jobs.iter().map(|job| view(job, with_segments, now)).collect()
    }

    /// Only the downloads with live connections: between list changes nothing else moves, so the
    /// periodic refresh costs the same with ten downloads or ten thousand.
    pub fn snapshot_running(&self) -> Vec<DownloadView> {
        let jobs = self.inner.state.lock().unwrap().jobs.clone();
        let now = Instant::now();
        jobs.iter().filter(|j| j.is_running()).map(|job| view(job, false, now)).collect()
    }

    /// Bumped whenever the list or a status changes, so the UI only refreshes when needed.
    pub fn version(&self) -> u64 {
        self.inner.version.load(Ordering::Relaxed)
    }

    /// Resolves once the list or a status changed (or `poke` was called).
    pub async fn wait_for_change(&self) {
        self.inner.changes.notified().await;
    }

    /// Wake whoever waits in `wait_for_change`.
    pub fn poke(&self) {
        self.inner.changes.notify_one();
    }

    pub fn has_active(&self) -> bool {
        self.inner.running.load(Ordering::SeqCst) > 0
    }

    /// Write the state file now.
    pub fn save(&self) {
        self.inner.write_store();
    }

    /// Stop for quitting: connections flush what they received and the part files are synced, so
    /// nothing is downloaded twice; the downloads that were running continue on the next start.
    pub fn shutdown(&self, wait: Duration) {
        self.inner.closing.store(true, Ordering::SeqCst);
        let jobs = self.inner.state.lock().unwrap().jobs.clone();
        for job in &jobs {
            let token = job.rt.lock().unwrap().cancel.clone();
            if let Some(t) = token {
                t.cancel();
            }
        }
        let deadline = Instant::now() + wait;
        while self.inner.running.load(Ordering::SeqCst) > 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(15));
        }
        self.inner.write_store();
    }
}

/// The UI's view of one download; also advances its speed meter.
fn view(job: &Job, with_segments: bool, now: Instant) -> DownloadView {
    let (record, downloaded, segment_count) = {
        let r = job.rec.lock().unwrap();
        let mut record = r.clone_without_segments();
        if with_segments {
            record.segments = r.segments.clone();
        }
        (record, r.downloaded(), r.segments.len())
    };
    let mut rt = job.rt.lock().unwrap();
    // once all bytes are in, a speed would only show the meter fading out
    let running = rt.cancel.is_some() && record.status != Status::Finishing;
    match rt.meter_at {
        Some(at) if running => {
            let dt = now.saturating_duration_since(at).as_secs_f64();
            if dt >= 0.4 {
                let inst = downloaded.saturating_sub(rt.meter_bytes) as f64 / dt;
                rt.speed = if rt.speed == 0.0 { inst } else { 0.5 * inst + 0.5 * rt.speed };
                rt.meter_bytes = downloaded;
                rt.meter_at = Some(now);
            }
        }
        _ => {
            rt.speed = 0.0;
            rt.meter_bytes = downloaded;
            rt.meter_at = Some(now);
        }
    }
    let eta = record.size.filter(|_| rt.speed > 1.0).map(|size| size.saturating_sub(downloaded) as f64 / rt.speed);
    DownloadView { downloaded, segment_count, finishing: rt.finishing.clone(), speed: rt.speed, eta, active_connections: rt.active, record }
}

/// Targets of unfinished downloads: a new download must not pick one of these names.
fn reserved_paths(st: &State) -> HashSet<PathBuf> {
    st.jobs
        .iter()
        .filter_map(|j| {
            let r = j.rec.lock().unwrap();
            (r.status != Status::Completed).then(|| PathBuf::from(&r.dir).join(&r.file_name))
        })
        .collect()
}

/// Create the record for a prepared link; returns its id.
fn insert(st: &mut State, reserved: &mut HashSet<PathBuf>, p: Prepared, verdict: Option<(VerdictSender, Expectation)>) -> String {
    let category = naming::category_for(&p.file_name);
    let dir = p.dir.unwrap_or_else(|| default_dir(&st.settings, category));
    let path = naming::unique_path(&dir, &p.file_name, reserved);
    reserved.insert(path.clone());
    let added_at = now_ms().max(st.last_added + 1);
    st.last_added = added_at;
    let id = uuid::Uuid::new_v4().to_string();
    let rec = Record {
        id: id.clone(),
        url: p.url,
        file_name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(p.file_name),
        dir: dir.to_string_lossy().into_owned(),
        category,
        size: p.size,
        resumable: false,
        connections: p.connections.unwrap_or(st.settings.connections).clamp(1, 32),
        segments: Vec::new(),
        status: if p.start { Status::Queued } else { Status::Paused },
        error: None,
        added_at,
        completed_at: None,
        part_path: None,
        headers: p.headers,
        layout: Layout::Single,
        etag: None,
        last_modified: None,
    };
    let job = Job::new(rec);
    {
        let mut rt = job.rt.lock().unwrap();
        rt.verdict = verdict;
        rt.confirm = p.confirm.then(|| Arc::new(tokio::sync::Notify::new()));
    }
    st.jobs.push(Arc::new(job));
    id
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

/// `Ok(None)` when there is no file yet, `Err` when it can't be read or parsed.
fn read_store(path: &Path) -> Result<Option<Stored>, ()> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    let text = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    serde_json::from_slice(text).map(Some).map_err(|_| ())
}

/// Read the saved state. A file that can't be parsed is set aside (never silently replaced by an
/// empty list) and the copy from the last good start is used instead.
fn load_store(path: &Path) -> Stored {
    match read_store(path) {
        Ok(Some(stored)) => {
            let _ = std::fs::copy(path, backup_path(path));
            stored
        }
        Ok(None) => Stored::default(),
        Err(()) => {
            let aside = path.with_extension(format!("corrupt-{}.json", now_ms()));
            let _ = std::fs::copy(path, aside);
            read_store(&backup_path(path)).ok().flatten().unwrap_or_default()
        }
    }
}

/// Replace `path` so that a crash at any point leaves either the old or the new contents.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    #[cfg(unix)]
    if let Some(dir) = path.parent().and_then(|d| std::fs::File::open(d).ok()) {
        let _ = dir.sync_all(); // make the rename itself durable
    }
    Ok(())
}

/// Writes the state file whenever something changed, coalescing bursts. Exits with the manager.
fn spawn_saver(inner: Weak<Inner>, saver: Arc<Saver>) {
    let _ = std::thread::Builder::new().name("byterush-save".into()).spawn(move || {
        loop {
            {
                let mut dirty = saver.dirty.lock().unwrap();
                while !*dirty {
                    if inner.strong_count() == 0 {
                        return;
                    }
                    dirty = saver.wake.wait_timeout(dirty, Duration::from_secs(1)).unwrap().0;
                }
            }
            std::thread::sleep(SAVE_DELAY);
            match inner.upgrade() {
                Some(inner) => inner.write_store(),
                None => return,
            }
        }
    });
}

/// Free and total space of the drive a folder is on. The folder need not exist yet: its nearest
/// existing parent is measured.
pub fn disk_space(dir: &Path) -> Option<DiskSpace> {
    let existing = dir.ancestors().find(|d| d.is_dir())?;
    let stats = fs4::statvfs(existing).ok()?;
    Some(DiskSpace { free: stats.available_space(), total: stats.total_space() })
}

fn default_dir(settings: &Settings, category: Category) -> PathBuf {
    let base = PathBuf::from(&settings.download_dir);
    match naming::category_folder(category) {
        Some(folder) if settings.category_subfolders => base.join(folder),
        _ => base,
    }
}

impl Inner {
    fn find(&self, ids: &[String]) -> Vec<Arc<Job>> {
        let st = self.state.lock().unwrap();
        st.jobs.iter().filter(|j| ids.contains(&j.rec.lock().unwrap().id)).cloned().collect()
    }

    fn changed(&self) {
        self.version.fetch_add(1, Ordering::Relaxed);
        self.saver.mark();
        self.changes.notify_one();
    }

    fn write_store(&self) {
        let _writer = self.save_lock.lock().unwrap();
        // anything that changes from here on is written by the next round
        *self.saver.dirty.lock().unwrap() = false;
        let stored = {
            let st = self.state.lock().unwrap();
            Stored { settings: st.settings.clone(), downloads: st.jobs.iter().map(|j| j.stored()).collect() }
        };
        if let Ok(json) = serde_json::to_vec(&stored) {
            let _ = write_atomic(&self.store_path, &json);
        }
    }

    /// Start queued downloads while there are free slots.
    fn pump(self: &Arc<Self>) {
        if self.closing.load(Ordering::SeqCst) {
            return;
        }
        let (starts, ctx) = {
            let st = self.state.lock().unwrap();
            let free = (st.settings.max_active as usize).saturating_sub(self.running.load(Ordering::SeqCst));
            if free == 0 {
                return;
            }
            let mut starts = Vec::new();
            for job in &st.jobs {
                if starts.len() >= free {
                    break;
                }
                if job.rec.lock().unwrap().status != Status::Queued {
                    continue;
                }
                if let Some(token) = job.begin(&self.running) {
                    starts.push((job.clone(), token));
                }
            }
            (starts, self.ctx(&st))
        };
        for (job, token) in starts {
            self.spawn(job, token, ctx.clone());
        }
    }

    /// Start one download now, regardless of the queue limit.
    fn start_now(self: &Arc<Self>, job: &Arc<Job>) {
        let ctx = self.ctx(&self.state.lock().unwrap());
        if let Some(token) = job.begin(&self.running) {
            self.spawn(job.clone(), token, ctx);
        }
    }

    fn ctx(&self, st: &State) -> Ctx {
        let temp_dir = Some(st.settings.temp_dir.trim()).filter(|d| !d.is_empty()).map(PathBuf::from);
        Ctx {
            client: st.client.clone(),
            limiter: self.limiter.clone(),
            retries: st.settings.retries as u32,
            temp_dir,
            saver: self.saver.clone(),
        }
    }

    fn spawn(self: &Arc<Self>, job: Arc<Job>, token: CancellationToken, ctx: Ctx) {
        let inner = self.clone();
        self.runtime.spawn(async move {
            let result = download::run(ctx, job.clone(), token.clone()).await;
            inner.finish(&job, &token, result);
        });
    }

    fn finish(self: &Arc<Self>, job: &Job, token: &CancellationToken, result: anyhow::Result<()>) {
        // failed before the first response arrived: the browser should keep the download
        let verdict = job.rt.lock().unwrap().verdict.take();
        if let Some((tx, _)) = verdict {
            let reason = match &result {
                Err(e) => err_string_ref(e),
                Ok(()) => "the download was stopped".into(),
            };
            let _ = tx.send(Err(reason));
        }
        {
            let mut r = job.rec.lock().unwrap();
            if r.status != Status::Completed {
                match result {
                    Err(e) if !token.is_cancelled() => {
                        r.status = Status::Error;
                        r.error = Some(err_string(e));
                    }
                    // paused (already shows it), resumed while the old connections were closing,
                    // or a browser hand-over that was turned down (`restore`)
                    _ if matches!(r.status, Status::Paused | Status::Queued | Status::Error) => {}
                    // never confirmed: it waits for the user, not for the next start
                    _ if r.status == Status::Waiting => r.status = Status::Paused,
                    // stopped because the app is quitting: continue on the next start
                    _ if self.closing.load(Ordering::SeqCst) => r.status = Status::Queued,
                    _ => r.status = Status::Paused,
                }
            }
            r.segments.iter_mut().for_each(|s| s.claimed = false);
        }
        {
            let mut rt = job.rt.lock().unwrap();
            rt.cancel = None;
            rt.active = 0;
            rt.finishing = None;
        }
        self.running.fetch_sub(1, Ordering::SeqCst);
        self.changed();
        self.pump();
    }
}
