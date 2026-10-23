//! Running one download: open the first connection, prepare the part file, then drive N connections.

use super::naming::{self, part_path};
use super::segments;
use super::types::{Expectation, Finishing, Layout, Segment, Status, now_ms};
use super::{Ctx, Job, Saver};
use anyhow::{Context, anyhow, bail};
use futures_util::StreamExt;
use reqwest::StatusCode;
use reqwest::header::{CONTENT_DISPOSITION, CONTENT_RANGE, CONTENT_TYPE, ETAG, HeaderMap, LAST_MODIFIED, RANGE, REFERER};
use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

/// How often a running download's progress is made durable: the part file is synced, then the
/// state file may record the progress that sync covers. After a crash or power cut the state never
/// claims bytes the disk doesn't have, and at most this much is downloaded again.
/// `BYTERUSH_CHECKPOINT_MS` overrides it (for tests).
fn checkpoint_every() -> Duration {
    let ms = std::env::var("BYTERUSH_CHECKPOINT_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(4000);
    Duration::from_millis(ms)
}

/// The server answered with this status instead of the file.
#[derive(Debug)]
pub struct HttpStatus(pub StatusCode);

impl std::fmt::Display for HttpStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = self.0;
        match s.as_u16() {
            401 => write!(f, "the server asks for a login ({s}): start the download in the browser so its session comes along"),
            403 => write!(
                f,
                "the server refused access ({s}): the link may have expired or need the browser's session; start it again in the browser to continue this download"
            ),
            404 | 410 => write!(f, "the file is no longer at this address ({s})"),
            429 => write!(f, "the server is limiting requests ({s}): try again later or with fewer connections"),
            _ => write!(f, "server answered {s}"),
        }
    }
}

impl std::error::Error for HttpStatus {}

/// The status behind an error, when it was the server's answer.
fn http_status(e: &anyhow::Error) -> Option<StatusCode> {
    e.downcast_ref::<HttpStatus>().map(|h| h.0)
}

/// What identifies one version of a file on the server.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Validators {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

impl Validators {
    fn of(headers: &HeaderMap) -> Self {
        let get = |name| headers.get(name).and_then(|v: &reqwest::header::HeaderValue| v.to_str().ok()).map(str::to_string);
        // weak ETags can differ between identical copies, so only strong ones say anything
        Self { etag: get(ETAG).filter(|e| !e.starts_with("W/")), last_modified: get(LAST_MODIFIED) }
    }

    /// Whether `other` is a different version. Every marker both sides have must disagree: servers
    /// behind a load balancer often give the same file different ETags (or dates), and starting a
    /// download over for nothing would throw away good progress.
    fn differs(&self, other: &Self) -> bool {
        let pairs = [(&self.etag, &other.etag), (&self.last_modified, &other.last_modified)];
        let compared: Vec<_> = pairs.iter().filter_map(|(a, b)| Some((a.as_ref()?, b.as_ref()?))).collect();
        !compared.is_empty() && compared.iter().all(|(a, b)| a != b)
    }
}

pub struct Probe {
    pub final_url: url::Url,
    pub file_name: String,
    pub size: Option<u64>,
    pub resumable: bool,
    pub content_type: Option<String>,
    pub validators: Validators,
}

/// `Content-Range: bytes 100-199/1000` — the start and the total (`*` = unknown).
struct ContentRange {
    start: Option<u64>,
    total: Option<u64>,
}

fn content_range(headers: &HeaderMap) -> Option<ContentRange> {
    let v = headers.get(CONTENT_RANGE)?.to_str().ok()?.trim();
    let v = v.strip_prefix("bytes").unwrap_or(v).trim();
    let (range, total) = v.split_once('/')?;
    let start = range.split_once('-').and_then(|(a, _)| a.trim().parse().ok());
    Some(ContentRange { start, total: total.trim().parse().ok() })
}

/// Size and range support from the reply to a `Range: bytes=0-…` request.
fn classify(resp: &reqwest::Response) -> anyhow::Result<(Option<u64>, bool)> {
    let status = resp.status();
    let total = content_range(resp.headers()).and_then(|r| r.total);
    if status == StatusCode::PARTIAL_CONTENT {
        Ok((total, total.is_some()))
    } else if status == StatusCode::RANGE_NOT_SATISFIABLE && total == Some(0) {
        Ok((Some(0), false)) // empty file
    } else if status.is_success() {
        Ok((resp.content_length(), false))
    } else {
        Err(HttpStatus(status).into())
    }
}

fn content_type(resp: &reqwest::Response) -> Option<String> {
    resp.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_string)
}

/// Headers that describe the browser session and are safe to replay; transport and range headers
/// are ours to set.
pub fn forwardable(name: &str) -> bool {
    !matches!(
        name.to_ascii_lowercase().as_str(),
        "host"
            | "connection"
            | "keep-alive"
            | "content-length"
            | "content-type"
            | "transfer-encoding"
            | "te"
            | "upgrade"
            | "range"
            | "if-range"
            | "if-modified-since"
            | "if-none-match"
            | "accept-encoding"
            | "proxy-authorization"
            | "proxy-connection"
    )
}

/// GET with the download's browser headers applied.
fn get(client: &reqwest::Client, url: &str, headers: &[(String, String)]) -> reqwest::RequestBuilder {
    headers
        .iter()
        .filter(|(k, _)| forwardable(k))
        .fold(client.get(url), |req, (k, v)| req.header(k.as_str(), v.as_str()))
}

/// The first request of a download. Hotlink protection refuses requests that don't come from one
/// of the site's pages: with no Referer to replay, a 403 is retried once as if coming from the
/// site's home page. Returns the response and the Referer that made it work, if one was needed.
async fn send_first(
    client: &reqwest::Client,
    url: &str,
    headers: &[(String, String)],
    range: &str,
) -> anyhow::Result<(reqwest::Response, Option<String>)> {
    let resp = get(client, url, headers).header(RANGE, range).send().await?;
    let has_referer = headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("referer"));
    if resp.status() != StatusCode::FORBIDDEN || has_referer {
        return Ok((resp, None));
    }
    let Some(origin) = url::Url::parse(url).ok().map(|u| format!("{}/", u.origin().ascii_serialization())) else {
        return Ok((resp, None));
    };
    let retry = get(client, url, headers).header(RANGE, range).header(REFERER, &origin).send().await?;
    if retry.status().is_success() { Ok((retry, Some(origin))) } else { Ok((resp, None)) }
}

/// Ask for the first byte: a 206 with Content-Range tells us the size and that ranges work.
pub async fn probe(client: &reqwest::Client, url: &str, headers: &[(String, String)]) -> anyhow::Result<Probe> {
    let parsed = url::Url::parse(url).context("invalid URL")?;
    let (resp, _) = send_first(client, parsed.as_str(), headers, "bytes=0-0").await?;
    let (size, resumable) = classify(&resp)?;
    let content_type = content_type(&resp);
    let validators = Validators::of(resp.headers());
    let final_url = resp.url().clone();
    let file_name = resp
        .headers()
        .get(CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .and_then(naming::from_content_disposition)
        .or_else(|| naming::from_url(&final_url))
        .or_else(|| naming::from_url(&parsed))
        .or_else(|| final_url.host_str().map(str::to_string))
        .unwrap_or_else(|| "download".into());
    Ok(Probe { final_url, file_name: naming::sanitize(&file_name), size, resumable, content_type, validators })
}

/// Where a saved download continues: its first unfinished range, and what the file was.
struct Resume {
    idx: usize,
    start: u64,
    end: u64,
    size: u64,
    validators: Validators,
}

pub async fn run(ctx: Ctx, job: Arc<Job>, cancel: CancellationToken) -> anyhow::Result<()> {
    if cancel.is_cancelled() {
        return Ok(());
    }
    let (url, headers, resume, all_done, known_size) = {
        let mut r = job.rec.lock().unwrap();
        r.status = Status::Connecting;
        r.error = None;
        let part_exists = r.part_path.as_deref().is_some_and(|p| Path::new(p).exists());
        let saved = r.resumable && part_exists && !r.segments.is_empty();
        let size = r.size.filter(|_| saved);
        let resume = size.and_then(|size| {
            let (idx, s) = r.segments.iter().enumerate().find(|(_, s)| s.remaining() > 0)?;
            let validators = Validators { etag: r.etag.clone(), last_modified: r.last_modified.clone() };
            Some(Resume { idx, start: s.pos(), end: s.end, size, validators })
        });
        let all_done = size.is_some() && resume.is_none();
        (r.url.clone(), r.headers.clone(), resume, all_done, r.size)
    };
    let opened = if all_done {
        // every byte is already on disk (the app stopped while finishing): only the last step is left
        FirstResponse { size: known_size, resumable: true, continues: true, ..FirstResponse::default() }
    } else {
        tokio::select! {
            s = open_first(&ctx.client, &url, &headers, resume) => s?,
            _ = cancel.cancelled() => return Ok(()),
        }
    };
    // a download handed over by the browser must get the same file the browser was getting
    let verdict = job.rt.lock().unwrap().verdict.take();
    let handed_over = verdict.is_some();
    if let Some((tx, expect)) = verdict {
        let check = mismatch(&opened, &expect);
        let _ = tx.send(match &check {
            Some(reason) => Err(reason.clone()),
            None => Ok(()),
        });
        if let Some(reason) = check {
            bail!(reason);
        }
    }
    // a file link answered with a web page is a login wall or a "your download will start" page:
    // saving it under the file's name would only look like a broken file. (A hand-over was already
    // compared with what the browser got, and the browser has let go of it by now.)
    let name = job.rec.lock().unwrap().file_name.clone();
    if !handed_over && serves_page_instead(&name, opened.content_type.as_deref()) {
        bail!("the site answered with a web page instead of the file (a login, captcha or \"download will start\" page): start the download in the browser");
    }
    let FirstResponse { size: probed_size, resumable, body: mut first, body_idx, continues, validators, referer, .. } = opened;

    let (target, part, fresh, size, connections, body_idx) = {
        let mut r = job.rec.lock().unwrap();
        if let Some(referer) = referer {
            r.headers.push(("Referer".into(), referer));
        }
        let target = PathBuf::from(&r.dir).join(&r.file_name);
        let existing = r.part_path.as_deref().map(PathBuf::from).filter(|p| p.exists());
        let can_continue = continues && resumable && r.resumable && r.size == probed_size && !r.segments.is_empty() && existing.is_some();
        // a resumed range must never be written into a fresh layout
        let body_idx = if can_continue {
            body_idx
        } else {
            if continues {
                first = None;
            }
            0
        };
        let part = match existing {
            Some(p) if can_continue => p,
            stale => {
                if let Some(old) = stale {
                    remove_part_files(&old);
                }
                match &ctx.temp_dir {
                    Some(dir) => dir.join(format!("{}.{}.byterush", r.file_name, &r.id[..8.min(r.id.len())])),
                    None => part_path(&target),
                }
            }
        };
        r.part_path = Some(part.to_string_lossy().into_owned());
        if can_continue {
            if validators.etag.is_some() {
                r.etag = validators.etag;
            }
            if validators.last_modified.is_some() {
                r.last_modified = validators.last_modified;
            }
        } else {
            r.etag = validators.etag;
            r.last_modified = validators.last_modified;
            r.size = probed_size;
            r.resumable = resumable;
            r.segments = match (resumable, probed_size) {
                (true, Some(size)) => segments::initial(size, r.connections),
                (_, size) => vec![Segment::new(0, size.unwrap_or(u64::MAX))],
            };
        }
        r.segments.iter_mut().for_each(|s| s.claimed = false);
        let connections = if r.resumable { r.connections.max(1) } else { 1 };
        if !can_continue {
            let parallel = r.resumable && connections > 1;
            r.layout = if parallel && !supports_sparse(part.parent()) { Layout::Parts } else { Layout::Single };
        }
        (target, part, !can_continue, r.size, connections, body_idx)
    };
    let layout = job.rec.lock().unwrap().layout;

    for dir in [target.parent(), part.parent()].into_iter().flatten() {
        std::fs::create_dir_all(dir).with_context(|| format!("cannot create {}", dir.display()))?;
    }
    if fresh {
        remove_part_files(&part);
    }
    let sink = Arc::new(match layout {
        Layout::Single => {
            let file = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(fresh)
                .open(&part)
                .with_context(|| format!("cannot open {}", part.display()))?;
            if fresh && let Some(size) = size {
                mark_sparse(&file);
                file.set_len(size)?;
            }
            Sink::Single(file)
        }
        Layout::Parts => Sink::Parts(Parts::new(part.clone())),
    });
    if cancel.is_cancelled() {
        return Ok(());
    }
    job.rec.lock().unwrap().status = Status::Downloading;

    let mut workers = JoinSet::new();
    for i in 0..connections {
        // the already-open first response keeps streaming as its segment
        let initial = if i == 0 {
            first.take().map(|resp| {
                job.rec.lock().unwrap().segments[body_idx].claimed = true;
                (body_idx, resp)
            })
        } else {
            None
        };
        workers.spawn(worker(ctx.clone(), job.clone(), sink.clone(), cancel.clone(), initial));
    }
    let stop_checkpoints = CancellationToken::new();
    let checkpointer = tokio::spawn(checkpoints(job.clone(), sink.clone(), ctx.saver.clone(), stop_checkpoints.clone()));
    let mut first_error = None;
    while let Some(res) = workers.join_next().await {
        match res {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                first_error.get_or_insert(e);
            }
            Err(e) => {
                first_error.get_or_insert(anyhow!(e));
            }
        }
    }
    stop_checkpoints.cancel();
    let _ = checkpointer.await;

    let complete = job.rec.lock().unwrap().segments.iter().all(|s| s.remaining() == 0);
    if cancel.is_cancelled() || !complete {
        // stopping part-way: everything counted so far goes to disk before the state records it
        let s = sink.clone();
        if let Ok(Ok(())) = tokio::task::spawn_blocking(move || s.sync()).await {
            job.rt.lock().unwrap().persisted = None;
        }
        if cancel.is_cancelled() {
            return Ok(());
        }
        return Err(first_error.unwrap_or_else(|| anyhow!("connection lost before the download finished")));
    }

    // until the file is in place the state keeps the last synced progress: a crash while finishing
    // fetches the unsynced tail again instead of trusting it
    job.rec.lock().unwrap().status = Status::Finishing;
    let final_path = if target.exists() {
        naming::unique_path(target.parent().unwrap_or(&target), &job.rec.lock().unwrap().file_name, &HashSet::new())
    } else {
        target
    };
    let finish_job = job.clone();
    let destination = final_path.clone();
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        match Arc::try_unwrap(sink).map_err(|_| anyhow!("file still in use"))? {
            Sink::Single(file) => {
                // no sync_all: forcing gigabytes out of the write cache took seconds and protects
                // nothing a rename on the same volume needs; a copy to another drive syncs itself
                drop(file);
                move_file(&finish_job, &part, &destination)
            }
            Sink::Parts(parts) => {
                let base = parts.base.clone();
                drop(parts); // close every part before reading them back
                rebuild(&finish_job, &base, &destination)
            }
        }
        .with_context(|| format!("cannot write {}", destination.display()))
    })
    .await??;

    {
        let mut r = job.rec.lock().unwrap();
        if let Some(name) = final_path.file_name() {
            r.file_name = name.to_string_lossy().into_owned();
        }
        r.part_path = None;
        // don't keep session cookies around once they are no longer needed
        r.headers.clear();
        r.size = Some(r.downloaded());
        r.status = Status::Completed;
        r.completed_at = Some(now_ms());
    }
    job.rt.lock().unwrap().persisted = None;
    Ok(())
}

/// Every few seconds: sync the part data, then let the state file record the progress it covers.
async fn checkpoints(job: Arc<Job>, sink: Arc<Sink>, saver: Arc<Saver>, stop: CancellationToken) {
    loop {
        tokio::select! {
            _ = tokio::time::sleep(checkpoint_every()) => {}
            _ = stop.cancelled() => return,
        }
        let progress = job.rec.lock().unwrap().segments.clone();
        let s = sink.clone();
        if let Ok(Ok(())) = tokio::task::spawn_blocking(move || s.sync()).await {
            job.rt.lock().unwrap().persisted = Some(progress);
            saver.mark();
        }
    }
}

/// A fresh download's first request doubles as the probe: it asks for the whole file as an open
/// range and keeps streaming, saving a round trip per file. A resumed download goes straight for
/// its first unfinished range, and that response tells whether the saved progress still applies.
async fn open_first(client: &reqwest::Client, url: &str, headers: &[(String, String)], resume: Option<Resume>) -> anyhow::Result<FirstResponse> {
    if let Some(rs) = resume {
        let (resp, referer) = send_first(client, url, headers, &format!("bytes={}-{}", rs.start, rs.end - 1)).await?;
        let status = resp.status();
        let range = content_range(resp.headers());
        let validators = Validators::of(resp.headers());
        let same = status == StatusCode::PARTIAL_CONTENT
            && range.is_some_and(|r| r.start == Some(rs.start) && r.total == Some(rs.size))
            && !rs.validators.differs(&validators);
        if same {
            return Ok(FirstResponse {
                size: Some(rs.size),
                resumable: true,
                content_type: content_type(&resp),
                body: Some(resp),
                body_idx: rs.idx,
                continues: true,
                validators,
                referer,
            });
        }
        // an expired link and the like: report it and keep the progress for a fresh link
        if !status.is_success() && status != StatusCode::RANGE_NOT_SATISFIABLE {
            return Err(HttpStatus(status).into());
        }
        // anything else means the file changed on the server: start over below
    }
    let (resp, referer) = send_first(client, url, headers, "bytes=0-").await?;
    let (size, resumable) = classify(&resp)?;
    let content_type = content_type(&resp);
    let validators = Validators::of(resp.headers());
    let body = (size != Some(0)).then_some(resp);
    Ok(FirstResponse { size, resumable: resumable && size.is_some(), content_type, body, body_idx: 0, continues: false, validators, referer })
}

#[derive(Default)]
struct FirstResponse {
    size: Option<u64>,
    resumable: bool,
    content_type: Option<String>,
    body: Option<reqwest::Response>,
    /// The segment `body` streams (0 for a fresh download).
    body_idx: usize,
    /// The saved progress still applies: same file on the server.
    continues: bool,
    validators: Validators,
    /// Referer that got past hotlink protection, kept for every later request.
    referer: Option<String>,
}

/// Whether a response of `content_type` for a file called `name` is a web page instead of the file.
fn serves_page_instead(name: &str, content_type: Option<&str>) -> bool {
    let html = content_type.is_some_and(|t| t.trim().to_ascii_lowercase().starts_with("text/html"));
    let page_name = naming::extension(name).is_none_or(|e| matches!(e.as_str(), "htm" | "html" | "xhtml" | "shtml" | "mht" | "mhtml" | "php" | "asp" | "aspx" | "jsp"));
    html && !page_name
}

/// Why the first response is not the file the browser was downloading, if it isn't:
/// bot checks and login walls answer with a web page, expired links with something else.
fn mismatch(first: &FirstResponse, expect: &Expectation) -> Option<String> {
    let is_html = |m: &str| m.trim().to_ascii_lowercase().starts_with("text/html");
    let got_html = first.content_type.as_deref().is_some_and(is_html);
    let wanted_html = expect.mime.as_deref().is_some_and(is_html);
    if got_html && !wanted_html {
        return Some("the site answered with a web page (bot check or login) instead of the file".into());
    }
    match (expect.size, first.size) {
        (Some(want), Some(got)) if want > 0 && want != got => {
            Some(format!("the site sent {got} bytes but the browser was getting {want}"))
        }
        _ => None,
    }
}

/// One connection: keeps claiming segments until there is nothing left to do.
async fn worker(
    ctx: Ctx,
    job: Arc<Job>,
    file: Arc<Sink>,
    cancel: CancellationToken,
    mut initial: Option<(usize, reqwest::Response)>,
) -> anyhow::Result<()> {
    loop {
        if cancel.is_cancelled() {
            return Ok(());
        }
        let (idx, preopened) = match initial.take() {
            Some((idx, resp)) => (idx, Some(resp)),
            None => {
                // a new connection waits for its first response, then still has to ramp up (TCP
                // slow start takes several round trips): about three times the request latency
                let latency = job.rt.lock().unwrap().request_latency;
                match segments::claim(&mut job.rec.lock().unwrap().segments, 3.0 * latency) {
                    Some(idx) => (idx, None),
                    None => return Ok(()),
                }
            }
        };
        job.rt.lock().unwrap().active += 1;
        let res = fetch_segment(&ctx, &job, &file, idx, &cancel, preopened).await;
        let others = {
            let mut rt = job.rt.lock().unwrap();
            rt.active -= 1;
            rt.active
        };
        job.rec.lock().unwrap().segments[idx].claimed = false;
        if let Err(e) = res {
            // Servers often cap connections per client: drop this connection and let the
            // remaining ones pick up its range. Only the last connection reports failure.
            return if others > 0 { Ok(()) } else { Err(e) };
        }
    }
}

/// Download one segment, retrying with backoff. Failures only count when no progress was made.
async fn fetch_segment(
    ctx: &Ctx,
    job: &Job,
    file: &Arc<Sink>,
    idx: usize,
    cancel: &CancellationToken,
    mut preopened: Option<reqwest::Response>,
) -> anyhow::Result<()> {
    let mut failures = 0u32;
    loop {
        let before = job.rec.lock().unwrap().segments[idx].pos();
        let result = fetch_once(ctx, job, file, idx, cancel, preopened.take()).await;
        if cancel.is_cancelled() {
            return Ok(());
        }
        let progressed = job.rec.lock().unwrap().segments[idx].pos() > before;
        let error = match result {
            Ok(true) => return Ok(()),
            Ok(false) => anyhow!("server keeps closing the connection"),
            Err(e) => e,
        };
        // a server that refuses an extra connection (403, 429, 503) is capping connections per
        // client: leave the range to the ones that work instead of hammering it with retries
        let refused = http_status(&error).is_some_and(|s| matches!(s.as_u16(), 403 | 429 | 503));
        if refused && job.rt.lock().unwrap().active > 1 {
            return Err(error);
        }
        failures = if progressed { 1 } else { failures + 1 };
        if failures > ctx.retries() {
            return Err(error);
        }
        let backoff = Duration::from_millis(500 * 2u64.pow(failures.min(5)));
        tokio::select! {
            _ = tokio::time::sleep(backoff) => {}
            _ = cancel.cancelled() => return Ok(()),
        }
    }
}

/// One HTTP request for the rest of a segment (or an already-open response for it).
/// `Ok(true)` when the segment is complete.
async fn fetch_once(
    ctx: &Ctx,
    job: &Job,
    file: &Arc<Sink>,
    idx: usize,
    cancel: &CancellationToken,
    preopened: Option<reqwest::Response>,
) -> anyhow::Result<bool> {
    let (url, headers, start, end, resumable) = {
        let mut r = job.rec.lock().unwrap();
        let resumable = r.resumable;
        let seg = &mut r.segments[idx];
        if seg.end != u64::MAX && seg.remaining() == 0 {
            return Ok(true);
        }
        if !resumable {
            // without range support the only way to continue is from the beginning
            seg.downloaded = 0;
        }
        let (start, end) = (seg.pos(), seg.end);
        (r.url.clone(), r.headers.clone(), start, end, resumable)
    };

    let resp = match preopened {
        Some(resp) => resp,
        None => {
            let mut req = get(&ctx.client, &url, &headers);
            if resumable {
                let range = if end == u64::MAX { format!("bytes={start}-") } else { format!("bytes={start}-{}", end - 1) };
                req = req.header(RANGE, range);
            }
            let sent = std::time::Instant::now();
            let resp = tokio::select! {
                r = req.send() => r?,
                _ = cancel.cancelled() => return Ok(false),
            };
            let latency = sent.elapsed().as_secs_f64();
            let mut rt = job.rt.lock().unwrap();
            rt.request_latency = if rt.request_latency == 0.0 { latency } else { 0.7 * rt.request_latency + 0.3 * latency };
            resp
        }
    };
    let status = resp.status();
    if !status.is_success() {
        return Err(HttpStatus(status).into());
    }
    if resumable && status != StatusCode::PARTIAL_CONTENT {
        bail!("server stopped honouring range requests ({status})");
    }

    let mut stream = resp.bytes_stream();
    let mut pending = Pending::new();
    loop {
        let next = tokio::select! {
            c = stream.next() => c,
            _ = cancel.cancelled() => {
                pending.flush(job, file, idx).await?;
                return Ok(false);
            }
        };
        let Some(chunk) = next else {
            pending.flush(job, file, idx).await?;
            let mut r = job.rec.lock().unwrap();
            let seg = &mut r.segments[idx];
            if seg.end == u64::MAX {
                seg.end = seg.pos();
            }
            return Ok(seg.remaining() == 0);
        };
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                pending.flush(job, file, idx).await?;
                return Err(e.into());
            }
        };
        // under a speed cap this can sleep for a while; a pause must not wait for it
        tokio::select! {
            _ = ctx.limiter.acquire(chunk.len()) => {}
            _ = cancel.cancelled() => {
                pending.flush(job, file, idx).await?;
                return Ok(false);
            }
        }
        // the segment may have shrunk because another connection took over its tail
        let take = {
            let r = job.rec.lock().unwrap();
            let seg = &r.segments[idx];
            let at = seg.pos() + pending.buf.len() as u64;
            if pending.buf.is_empty() {
                pending.offset = at;
            }
            seg.end.saturating_sub(at).min(chunk.len() as u64) as usize
        };
        pending.buf.extend_from_slice(&chunk[..take]);
        let segment_full = take < chunk.len();
        if segment_full || pending.due() {
            pending.flush(job, file, idx).await?;
        }
        if segment_full || job.rec.lock().unwrap().segments[idx].remaining() == 0 {
            return Ok(true);
        }
    }
}

/// Bytes received by one connection but not yet on disk. Writing happens off the async threads
/// and outside the record lock: on Windows the first write far into a new file can take long
/// (the file system zero-fills up to it), and nothing else may wait on that.
struct Pending {
    offset: u64,
    buf: Vec<u8>,
    last_flush: std::time::Instant,
}

impl Pending {
    const FLUSH_BYTES: usize = 512 * 1024;

    fn new() -> Self {
        Self { offset: 0, buf: Vec::with_capacity(Self::FLUSH_BYTES), last_flush: std::time::Instant::now() }
    }

    /// Flush by size, or often enough that progress keeps moving on slow connections.
    fn due(&self) -> bool {
        self.buf.len() >= Self::FLUSH_BYTES || self.last_flush.elapsed() >= Duration::from_millis(250)
    }

    async fn flush(&mut self, job: &Job, sink: &Arc<Sink>, idx: usize) -> anyhow::Result<()> {
        let since = std::mem::replace(&mut self.last_flush, std::time::Instant::now()).elapsed().as_secs_f64();
        if self.buf.is_empty() {
            return Ok(());
        }
        if since > 0.0 {
            // how fast this connection is going, for deciding whether splitting its range pays off
            let mut r = job.rec.lock().unwrap();
            let seg = &mut r.segments[idx];
            let inst = self.buf.len() as f64 / since;
            seg.rate = if seg.rate == 0 { inst as u64 } else { (0.7 * seg.rate as f64 + 0.3 * inst) as u64 };
            seg.rate_at = Some(std::time::Instant::now());
        }
        let buf = std::mem::replace(&mut self.buf, Vec::with_capacity(Self::FLUSH_BYTES));
        let start = job.rec.lock().unwrap().segments[idx].start;
        let (offset, len, sink) = (self.offset, buf.len() as u64, sink.clone());
        tokio::task::spawn_blocking(move || sink.write(idx, start, offset, &buf)).await??;
        let mut r = job.rec.lock().unwrap();
        let seg = &mut r.segments[idx];
        // count only what still belongs to this segment (its tail may have been taken over);
        // anything written past it is the same server data the other connection writes too
        if seg.pos() == offset {
            seg.downloaded += len.min(seg.end.saturating_sub(offset));
        }
        Ok(())
    }
}

/// Where a download's bytes go while it runs.
pub(crate) enum Sink {
    Single(File),
    Parts(Parts),
}

/// One file per segment (`<base>.<i>`), each opened once and kept open while the download runs.
pub(crate) struct Parts {
    base: PathBuf,
    files: Mutex<HashMap<usize, Arc<File>>>,
}

impl Parts {
    fn new(base: PathBuf) -> Self {
        Self { base, files: Mutex::new(HashMap::new()) }
    }

    fn file(&self, idx: usize) -> std::io::Result<Arc<File>> {
        if let Some(file) = self.files.lock().unwrap().get(&idx) {
            return Ok(file.clone());
        }
        let file = Arc::new(OpenOptions::new().create(true).write(true).truncate(false).open(segment_file(&self.base, idx))?);
        Ok(self.files.lock().unwrap().entry(idx).or_insert(file).clone())
    }
}

impl Sink {
    fn write(&self, idx: usize, seg_start: u64, offset: u64, buf: &[u8]) -> std::io::Result<()> {
        match self {
            Sink::Single(file) => write_all_at(file, buf, offset),
            Sink::Parts(parts) => write_all_at(&*parts.file(idx)?, buf, offset - seg_start),
        }
    }

    /// Make everything written so far durable.
    fn sync(&self) -> std::io::Result<()> {
        match self {
            Sink::Single(file) => file.sync_data(),
            Sink::Parts(parts) => {
                let files: Vec<Arc<File>> = parts.files.lock().unwrap().values().cloned().collect();
                files.iter().try_for_each(|f| f.sync_data())
            }
        }
    }
}

fn segment_file(base: &Path, idx: usize) -> PathBuf {
    let mut s = base.as_os_str().to_owned();
    s.push(format!(".{idx}"));
    PathBuf::from(s)
}

/// Delete a download's partial data: the single part file and any per-segment files.
pub(crate) fn remove_part_files(base: &Path) {
    let _ = std::fs::remove_file(base);
    let (Some(dir), Some(name)) = (base.parent(), base.file_name()) else { return };
    let prefix = format!("{}.", name.to_string_lossy());
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.strip_prefix(&prefix).is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

const COPY_CHUNK: usize = 8 * 1024 * 1024;

fn report(job: &Job, stage: &'static str, done: u64, total: u64) {
    job.rt.lock().unwrap().finishing = Some(Finishing { stage, done, total });
}

/// Join the segment files in order into the final file ("rebuilding"). The file is assembled under
/// a temporary name and renamed into place, so a crash never leaves half a file under the real name.
fn rebuild(job: &Job, base: &Path, out: &Path) -> anyhow::Result<()> {
    let mut segments: Vec<(usize, u64, u64)> = {
        let r = job.rec.lock().unwrap();
        r.segments.iter().enumerate().map(|(i, s)| (i, s.start, s.end)).collect()
    };
    segments.sort_by_key(|&(_, start, _)| start);
    let total: u64 = segments.iter().map(|&(_, a, b)| b.saturating_sub(a)).sum();
    let staging = naming::staging_path(out);
    let result = (|| -> anyhow::Result<()> {
        let mut writer = std::io::BufWriter::with_capacity(COPY_CHUNK, File::create(&staging)?);
        let mut buf = vec![0u8; COPY_CHUNK];
        let mut done = 0u64;
        report(job, "rebuilding", 0, total);
        for (idx, start, end) in segments {
            let mut left = end.saturating_sub(start);
            if left == 0 {
                continue;
            }
            let mut part = File::open(segment_file(base, idx)).with_context(|| format!("part {idx} is missing"))?;
            while left > 0 {
                let n = (left as usize).min(buf.len());
                part.read_exact(&mut buf[..n]).with_context(|| format!("part {idx} is incomplete"))?;
                writer.write_all(&buf[..n])?;
                left -= n as u64;
                done += n as u64;
                report(job, "rebuilding", done, total);
            }
        }
        writer.into_inner().map_err(|e| e.into_error())?.sync_all()?;
        std::fs::rename(&staging, out)?;
        Ok(())
    })();
    match result {
        Ok(()) => {
            remove_part_files(base);
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&staging);
            Err(e)
        }
    }
}

/// Rename into place, or copy with progress when the temp folder is on another drive (into a
/// temporary name first, so an interrupted copy never looks like the finished file).
fn move_file(job: &Job, from: &Path, to: &Path) -> anyhow::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    let total = std::fs::metadata(from)?.len();
    let staging = naming::staging_path(to);
    let result = (|| -> anyhow::Result<()> {
        let mut reader = File::open(from)?;
        let mut writer = File::create(&staging)?;
        let mut buf = vec![0u8; COPY_CHUNK];
        let mut done = 0u64;
        report(job, "moving", 0, total);
        loop {
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            writer.write_all(&buf[..n])?;
            done += n as u64;
            report(job, "moving", done, total);
        }
        writer.sync_all()?;
        drop(writer);
        std::fs::rename(&staging, to)?;
        Ok(())
    })();
    match result {
        Ok(()) => {
            std::fs::remove_file(from)?;
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&staging);
            Err(e)
        }
    }
}

/// Whether the volume holding `dir` supports sparse files (NTFS, ReFS do; exFAT, FAT32 don't).
/// `BYTERUSH_FORCE_PARTS=1` forces the part-file layout (for tests).
fn supports_sparse(dir: Option<&Path>) -> bool {
    if std::env::var_os("BYTERUSH_FORCE_PARTS").is_some() {
        return false;
    }
    let Some(dir) = dir else { return true };
    volume_supports_sparse(dir)
}

#[cfg(windows)]
fn volume_supports_sparse(dir: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{GetVolumeInformationW, GetVolumePathNameW};
    const FILE_SUPPORTS_SPARSE_FILES: u32 = 0x0000_0040;
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut root = [0u16; 1024];
    let mut flags = 0u32;
    unsafe {
        if GetVolumePathNameW(wide.as_ptr(), root.as_mut_ptr(), root.len() as u32) == 0 {
            return true;
        }
        if GetVolumeInformationW(
            root.as_ptr(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut flags,
            std::ptr::null_mut(),
            0,
        ) == 0
        {
            return true;
        }
    }
    flags & FILE_SUPPORTS_SPARSE_FILES != 0
}

/// Unix file systems create holes on `set_len`.
#[cfg(not(windows))]
fn volume_supports_sparse(_dir: &Path) -> bool {
    true
}

/// On NTFS a write far into a new file first zero-fills everything before it (gigabytes for a big
/// download). A sparse file skips that; unwritten ranges are simply holes until filled.
#[cfg(windows)]
fn mark_sparse(file: &File) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::IO::DeviceIoControl;
    use windows_sys::Win32::System::Ioctl::FSCTL_SET_SPARSE;
    let mut returned = 0u32;
    // best effort: FAT/exFAT volumes don't support sparse files and just keep the old behaviour
    unsafe {
        DeviceIoControl(
            file.as_raw_handle() as _,
            FSCTL_SET_SPARSE,
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            0,
            &mut returned,
            std::ptr::null_mut(),
        );
    }
}

/// Other platforms create sparse files on `set_len` already.
#[cfg(not(windows))]
fn mark_sparse(_file: &File) {}

fn write_all_at(file: &File, mut buf: &[u8], mut offset: u64) -> std::io::Result<()> {
    while !buf.is_empty() {
        #[cfg(windows)]
        let n = std::os::windows::fs::FileExt::seek_write(file, buf, offset)?;
        #[cfg(unix)]
        let n = std::os::unix::fs::FileExt::write_at(file, buf, offset)?;
        if n == 0 {
            return Err(std::io::ErrorKind::WriteZero.into());
        }
        buf = &buf[n..];
        offset += n as u64;
    }
    Ok(())
}
