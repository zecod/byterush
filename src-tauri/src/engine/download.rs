//! Running one download: open the first connection, prepare the part file, then drive N connections.

use super::naming::{self, part_path};
use super::segments;
use super::types::{Expectation, Finishing, Layout, Segment, Status, now_ms};
use super::{Ctx, Job};
use anyhow::{Context, anyhow, bail};
use futures_util::StreamExt;
use reqwest::StatusCode;
use reqwest::header::{CONTENT_DISPOSITION, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

pub struct Probe {
    pub final_url: url::Url,
    pub file_name: String,
    pub size: Option<u64>,
    pub resumable: bool,
    pub content_type: Option<String>,
}

/// Size and range support from the reply to a `Range: bytes=0-…` request.
fn classify(resp: &reqwest::Response) -> anyhow::Result<(Option<u64>, bool)> {
    let status = resp.status();
    let total = || {
        resp.headers()
            .get(CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.rsplit('/').next())
            .and_then(|t| t.trim().parse::<u64>().ok())
    };
    if status == StatusCode::PARTIAL_CONTENT {
        let total = total();
        Ok((total, total.is_some()))
    } else if status == StatusCode::RANGE_NOT_SATISFIABLE && total() == Some(0) {
        Ok((Some(0), false)) // empty file
    } else if status.is_success() {
        Ok((resp.content_length(), false))
    } else {
        bail!("server answered {status}")
    }
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

/// Ask for the first byte: a 206 with Content-Range tells us the size and that ranges work.
pub async fn probe(client: &reqwest::Client, url: &str, headers: &[(String, String)]) -> anyhow::Result<Probe> {
    let parsed = url::Url::parse(url).context("invalid URL")?;
    let resp = get(client, parsed.as_str(), headers).header(RANGE, "bytes=0-0").send().await?;
    let (size, resumable) = classify(&resp)?;
    let headers = resp.headers();
    let content_type = headers.get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_string);
    let final_url = resp.url().clone();
    let file_name = headers
        .get(CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .and_then(naming::from_content_disposition)
        .or_else(|| naming::from_url(&final_url))
        .or_else(|| naming::from_url(&parsed))
        .or_else(|| final_url.host_str().map(str::to_string))
        .unwrap_or_else(|| "download".into());
    Ok(Probe { final_url, file_name: naming::sanitize(&file_name), size, resumable, content_type })
}

pub async fn run(ctx: Ctx, job: Arc<Job>, cancel: CancellationToken) -> anyhow::Result<()> {
    if cancel.is_cancelled() {
        return Ok(());
    }
    let (url, headers, resuming) = {
        let mut r = job.rec.lock().unwrap();
        r.status = Status::Connecting;
        r.error = None;
        let part_exists = r.part_path.as_deref().is_some_and(|p| std::path::Path::new(p).exists());
        (r.url.clone(), r.headers.clone(), r.resumable && !r.segments.is_empty() && part_exists)
    };
    let opened = tokio::select! {
        s = open_first(&ctx.client, &url, &headers, resuming) => s?,
        _ = cancel.cancelled() => return Ok(()),
    };
    // a download handed over by the browser must get the same file the browser was getting
    let verdict = job.rt.lock().unwrap().verdict.take();
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
    let FirstResponse { size: probed_size, resumable, body: mut first, .. } = opened;

    let (target, part, fresh, size, connections) = {
        let mut r = job.rec.lock().unwrap();
        let target = PathBuf::from(&r.dir).join(&r.file_name);
        let existing = r.part_path.as_deref().map(PathBuf::from).filter(|p| p.exists());
        let can_continue = resumable && r.resumable && r.size == probed_size && !r.segments.is_empty() && existing.is_some();
        let part = match existing {
            Some(p) if can_continue => p,
            stale => {
                if let Some(old) = stale {
                    let _ = std::fs::remove_file(old);
                }
                match &ctx.temp_dir {
                    Some(dir) => dir.join(format!("{}.{}.byterush", r.file_name, &r.id[..8.min(r.id.len())])),
                    None => part_path(&target),
                }
            }
        };
        r.part_path = Some(part.to_string_lossy().into_owned());
        if !can_continue {
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
        (target, part, !can_continue, r.size, connections)
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
        Layout::Parts => Sink::Parts(part.clone()),
    });
    if cancel.is_cancelled() {
        return Ok(());
    }
    job.rec.lock().unwrap().status = Status::Downloading;

    let mut workers = JoinSet::new();
    for i in 0..connections {
        // the already-open first response keeps streaming as segment 0
        let initial = if i == 0 {
            first.take().map(|resp| {
                job.rec.lock().unwrap().segments[0].claimed = true;
                (0, resp)
            })
        } else {
            None
        };
        workers.spawn(worker(ctx.clone(), job.clone(), sink.clone(), cancel.clone(), initial));
    }
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
    if cancel.is_cancelled() {
        return Ok(());
    }

    let complete = job.rec.lock().unwrap().segments.iter().all(|s| s.remaining() == 0);
    if !complete {
        return Err(first_error.unwrap_or_else(|| anyhow!("connection lost before the download finished")));
    }

    job.rec.lock().unwrap().status = Status::Finishing;
    let final_path = if target.exists() {
        naming::unique_path(target.parent().unwrap_or(&target), &job.rec.lock().unwrap().file_name, &[])
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
            Sink::Parts(base) => rebuild(&finish_job, &base, &destination),
        }
        .with_context(|| format!("cannot write {}", destination.display()))
    })
    .await??;

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
    Ok(())
}

/// A fresh download's first request doubles as the probe: it asks for the whole file as an open
/// range and keeps streaming, saving a round trip per file. Resuming checks the file first so a
/// file that changed on the server restarts cleanly.
async fn open_first(
    client: &reqwest::Client,
    url: &str,
    headers: &[(String, String)],
    resuming: bool,
) -> anyhow::Result<FirstResponse> {
    if resuming {
        let p = probe(client, url, headers).await?;
        return Ok(FirstResponse { size: p.size, resumable: p.resumable && p.size.is_some(), content_type: p.content_type, body: None });
    }
    let resp = get(client, url, headers).header(RANGE, "bytes=0-").send().await?;
    let (size, resumable) = classify(&resp)?;
    let content_type = resp.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_string);
    let body = (size != Some(0)).then_some(resp);
    Ok(FirstResponse { size, resumable: resumable && size.is_some(), content_type, body })
}

struct FirstResponse {
    size: Option<u64>,
    resumable: bool,
    content_type: Option<String>,
    body: Option<reqwest::Response>,
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
            // a new connection waits for its first response, then still has to ramp up (TCP slow
            // start takes several round trips): about three times the request latency in all
            None => match segments::claim(&mut job.rec.lock().unwrap().segments, 3.0 * job.rt.lock().unwrap().request_latency) {
                Some(idx) => (idx, None),
                None => return Ok(()),
            },
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
    if resumable && status != StatusCode::PARTIAL_CONTENT {
        bail!("server stopped honouring range requests ({status})");
    }
    if !status.is_success() {
        bail!("server answered {status}");
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
    /// Base path; segment `i` lives in `<base>.<i>`.
    Parts(PathBuf),
}

impl Sink {
    fn write(&self, idx: usize, seg_start: u64, offset: u64, buf: &[u8]) -> std::io::Result<()> {
        match self {
            Sink::Single(file) => write_all_at(file, buf, offset),
            Sink::Parts(base) => {
                let file = OpenOptions::new().create(true).write(true).truncate(false).open(segment_file(base, idx))?;
                write_all_at(&file, buf, offset - seg_start)
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

/// Join the segment files in order into the final file ("rebuilding").
fn rebuild(job: &Job, base: &Path, out: &Path) -> anyhow::Result<()> {
    let mut segments: Vec<(usize, u64, u64)> = {
        let r = job.rec.lock().unwrap();
        r.segments.iter().enumerate().map(|(i, s)| (i, s.start, s.end)).collect()
    };
    segments.sort_by_key(|&(_, start, _)| start);
    let total: u64 = segments.iter().map(|&(_, a, b)| b.saturating_sub(a)).sum();
    let result = (|| -> anyhow::Result<()> {
        let mut writer = std::io::BufWriter::with_capacity(COPY_CHUNK, File::create(out)?);
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
        Ok(())
    })();
    match result {
        Ok(()) => {
            remove_part_files(base);
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(out);
            Err(e)
        }
    }
}

/// Rename into place, or copy with progress when the temp folder is on another drive.
fn move_file(job: &Job, from: &Path, to: &Path) -> anyhow::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    let total = std::fs::metadata(from)?.len();
    let result = (|| -> anyhow::Result<()> {
        let mut reader = File::open(from)?;
        let mut writer = File::create(to)?;
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
        Ok(())
    })();
    match result {
        Ok(()) => {
            std::fs::remove_file(from)?;
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(to);
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
