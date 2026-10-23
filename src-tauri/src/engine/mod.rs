//! Download engine: queue, persistence and lifecycle. Independent of Tauri so it can be tested.

mod download;
mod limiter;
pub mod naming;
mod segments;
pub mod types;

use limiter::Limiter;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;
pub use types::*;

/// What a running download needs from the manager.
#[derive(Clone)]
pub(crate) struct Ctx {
    client: reqwest::Client,
    limiter: Arc<Limiter>,
    retries: u32,
    temp_dir: Option<PathBuf>,
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

/// Reports whether a download's first response matched what the browser was getting.
type VerdictSender = tokio::sync::oneshot::Sender<Result<(), String>>;

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

fn build_client(user_agent: &str) -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(user_agent)
        // one TCP connection per segment, like a classic download accelerator
        .http1_only()
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
        if settings.user_agent.contains("Fetchr/") {
            settings.user_agent = Settings::default().user_agent; // default from before the rename
        }
        let jobs: Vec<Arc<Job>> = stored
            .downloads
            .into_iter()
            .map(|mut rec| {
                // nothing runs after a restart; the user resumes explicitly
                if matches!(rec.status, Status::Queued | Status::Connecting | Status::Downloading | Status::Finishing) {
                    rec.status = Status::Paused;
                }
                Arc::new(Job { rec: Mutex::new(rec), rt: Mutex::new(Runtime::default()) })
            })
            .collect();
        let limiter = Arc::new(Limiter::new(settings.speed_limit_kbps * 1024));
        let client = build_client(&settings.user_agent);
        let last_added = jobs.iter().map(|j| j.rec.lock().unwrap().added_at).max().unwrap_or(0);
        Self {
            inner: Arc::new(Inner {
                state: Mutex::new(State { settings, client, jobs, last_added }),
                limiter,
                store_path,
                runtime,
                version: AtomicU64::new(1),
            }),
        }
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
            if settings.user_agent != st.settings.user_agent {
                st.client = build_client(&settings.user_agent);
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
        })
    }

    pub async fn add(&self, req: AddRequest) -> Result<String, String> {
        let id = self.add_inner(req).await?;
        self.inner.changed();
        self.inner.pump();
        Ok(id)
    }

    /// Add many links with a single save. Names come from the URL when possible, so large batches
    /// don't wait for a network round trip per link. Returns the new ids and per-link errors.
    pub async fn add_many(&self, requests: Vec<AddRequest>) -> (Vec<String>, Vec<String>) {
        let mut ids = Vec::new();
        let mut errors = Vec::new();
        for req in requests {
            let url = req.url.clone();
            match self.add_inner(req).await {
                Ok(id) => ids.push(id),
                Err(e) => errors.push(format!("{url}: {e}")),
            }
        }
        self.inner.changed();
        self.inner.pump();
        (ids, errors)
    }

    async fn add_inner(&self, req: AddRequest) -> Result<String, String> {
        let url = req.url.trim().to_string();
        let parsed = url::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
        let given = req.file_name.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(naming::sanitize);
        let from_url = naming::from_url(&parsed).filter(|n| naming::extension(n).is_some()).map(|n| naming::sanitize(&n));
        let (file_name, size) = match given.or(from_url) {
            Some(name) => (name, req.size),
            None => {
                let p = self.probe_with(&url, &req.headers).await?;
                (p.file_name, p.size)
            }
        };
        let category = naming::category_for(&file_name);
        let id = uuid::Uuid::new_v4().to_string();
        {
            let mut st = self.inner.state.lock().unwrap();
            let dir = req
                .dir
                .as_deref()
                .map(str::trim)
                .filter(|d| !d.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| default_dir(&st.settings, category));
            let reserved: Vec<PathBuf> = st
                .jobs
                .iter()
                .map(|j| j.rec.lock().unwrap())
                .filter(|r| r.status != Status::Completed)
                .map(|r| PathBuf::from(&r.dir).join(&r.file_name))
                .collect();
            let path = naming::unique_path(&dir, &file_name, &reserved);
            let added_at = now_ms().max(st.last_added + 1);
            st.last_added = added_at;
            let rec = Record {
                id: id.clone(),
                url,
                file_name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(file_name),
                dir: dir.to_string_lossy().into_owned(),
                category,
                size,
                resumable: false,
                connections: req.connections.unwrap_or(st.settings.connections).clamp(1, 32),
                segments: Vec::new(),
                status: if req.start { Status::Queued } else { Status::Paused },
                error: None,
                added_at,
                completed_at: None,
                part_path: None,
                headers: req.headers.into_iter().filter(|(k, _)| download::forwardable(k)).collect(),
                layout: Layout::Single,
            };
            st.jobs.push(Arc::new(Job { rec: Mutex::new(rec), rt: Mutex::new(Runtime::default()) }));
        }
        Ok(id)
    }

    /// Add a download handed over by the browser and start it right away, outside the queue.
    /// The receiver reports whether the first response is the file the browser was getting.
    pub async fn add_watched(
        &self,
        req: AddRequest,
        expect: Expectation,
    ) -> Result<(String, tokio::sync::oneshot::Receiver<Result<(), String>>), String> {
        let id = self.add_inner(AddRequest { start: true, ..req }).await?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        if let Some(job) = self.inner.find(&[id.clone()]).pop() {
            job.rt.lock().unwrap().verdict = Some((tx, expect));
            self.inner.changed();
            self.inner.start_now(&job);
        }
        Ok((id, rx))
    }

    pub fn browser_integration(&self) -> bool {
        self.inner.state.lock().unwrap().settings.browser_integration
    }

    pub fn pause(&self, ids: &[String]) {
        for job in self.inner.find(ids) {
            let token = job.rt.lock().unwrap().cancel.clone();
            if let Some(t) = &token {
                t.cancel();
            }
            // show the pause right away; the connections wind down in the background
            let mut r = job.rec.lock().unwrap();
            if matches!(r.status, Status::Queued | Status::Connecting | Status::Downloading) {
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
        let removed: Vec<Arc<Job>> = {
            let mut st = self.inner.state.lock().unwrap();
            let (gone, keep): (Vec<_>, Vec<_>) =
                st.jobs.drain(..).partition(|j| ids.contains(&j.rec.lock().unwrap().id));
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
        self.snapshot(true).into_iter().find(|d| d.record.id == id)
    }

    /// Every download; `with_segments: false` keeps list payloads small.
    pub fn snapshot(&self, with_segments: bool) -> Vec<DownloadView> {
        let jobs = self.inner.state.lock().unwrap().jobs.clone();
        let now = Instant::now();
        jobs.iter()
            .map(|job| {
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
                        let dt = now.duration_since(at).as_secs_f64();
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
                let eta = record
                    .size
                    .filter(|_| rt.speed > 1.0)
                    .map(|size| size.saturating_sub(downloaded) as f64 / rt.speed);
                DownloadView {
                    downloaded,
                    segment_count,
                    finishing: rt.finishing.clone(),
                    speed: rt.speed,
                    eta,
                    active_connections: rt.active,
                    record,
                }
            })
            .collect()
    }

    /// Bumped whenever the list or a status changes, so the UI only refreshes when needed.
    pub fn version(&self) -> u64 {
        self.inner.version.load(Ordering::Relaxed)
    }

    pub fn has_active(&self) -> bool {
        self.inner.state.lock().unwrap().jobs.iter().any(|j| j.rt.lock().unwrap().cancel.is_some())
    }

    pub fn save(&self) {
        self.inner.save();
    }
}

/// Read the saved state. A file that can't be parsed is set aside rather than silently replaced
/// by an empty list on the next save.
fn load_store(path: &std::path::Path) -> Stored {
    let Ok(bytes) = std::fs::read(path) else { return Stored::default() };
    let text = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    match serde_json::from_slice(text) {
        Ok(stored) => stored,
        Err(_) => {
            let backup = path.with_extension(format!("corrupt-{}.json", now_ms()));
            let _ = std::fs::copy(path, backup);
            Stored::default()
        }
    }
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
        self.save();
    }

    fn save(&self) {
        let stored = {
            let st = self.state.lock().unwrap();
            Stored {
                settings: st.settings.clone(),
                downloads: st.jobs.iter().map(|j| j.rec.lock().unwrap().clone()).collect(),
            }
        };
        let Ok(json) = serde_json::to_vec_pretty(&stored) else { return };
        let tmp = self.store_path.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &self.store_path);
        }
    }

    /// Start queued downloads while there are free slots.
    fn pump(self: &Arc<Self>) {
        let (starts, ctx) = {
            let st = self.state.lock().unwrap();
            let running = st.jobs.iter().filter(|j| j.rt.lock().unwrap().cancel.is_some()).count();
            let free = (st.settings.max_active as usize).saturating_sub(running);
            let mut starts = Vec::new();
            for job in &st.jobs {
                if starts.len() >= free {
                    break;
                }
                if job.rec.lock().unwrap().status != Status::Queued {
                    continue;
                }
                let mut rt = job.rt.lock().unwrap();
                if rt.cancel.is_none() {
                    let token = CancellationToken::new();
                    rt.cancel = Some(token.clone());
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
        let token = {
            let mut rt = job.rt.lock().unwrap();
            if rt.cancel.is_some() {
                return;
            }
            let token = CancellationToken::new();
            rt.cancel = Some(token.clone());
            token
        };
        self.spawn(job.clone(), token, ctx);
    }

    fn ctx(&self, st: &State) -> Ctx {
        let temp_dir = Some(st.settings.temp_dir.trim()).filter(|d| !d.is_empty()).map(PathBuf::from);
        Ctx { client: st.client.clone(), limiter: self.limiter.clone(), retries: st.settings.retries as u32, temp_dir }
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
        if let Some((tx, _)) = job.rt.lock().unwrap().verdict.take() {
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
                    // resumed while the old connections were still closing
                    _ if r.status == Status::Queued => {}
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
        self.changed();
        self.pump();
    }
}
