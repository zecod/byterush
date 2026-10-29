//! Crashes, restarts and unfriendly servers: progress survives, files are never mixed up, and
//! common 403 causes (hotlink protection, per-client connection caps) don't stop a download.

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use byterush_lib::engine::{AddRequest, DownloadView, Manager, Status};
use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime};

const MB: usize = 1024 * 1024;

fn pattern(len: usize, seed: u32) -> Vec<u8> {
    (0..len as u32).map(|i| (i.wrapping_add(seed).wrapping_mul(2654435761) >> 13) as u8).collect()
}

async fn serve_dir(dir: PathBuf) -> String {
    let app = axum::Router::new().fallback_service(tower_http::services::ServeDir::new(dir));
    listen(app).await
}

async fn listen(app: axum::Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

fn manager(dir: &Path) -> Manager {
    Manager::new(dir.join("state.json"), dir.to_path_buf(), tokio::runtime::Handle::current())
}

fn set_cap(m: &Manager, kbps: u64) {
    let mut s = m.settings();
    s.speed_limit_kbps = kbps;
    m.update_settings(s);
}

async fn wait_for(manager: &Manager, id: &str, status: Status) -> DownloadView {
    for _ in 0..600 {
        let view = manager.get(id).unwrap();
        if view.record.status == status {
            return view;
        }
        assert_ne!(view.record.status, Status::Error, "download failed: {:?}", view.record.error);
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("timed out waiting for {status:?}");
}

fn stored_progress(state: &Path) -> u64 {
    let Ok(text) = std::fs::read_to_string(state) else { return 0 };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return 0 };
    v["downloads"][0]["segments"].as_array().map(|s| s.iter().filter_map(|s| s["downloaded"].as_u64()).sum()).unwrap_or(0)
}

fn stored_status(state: &Path) -> String {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(state).unwrap()).unwrap();
    v["downloads"][0]["status"].as_str().unwrap().to_string()
}

/// The download half of `killed_mid_download_resumes_on_restart`, run in a separate process so it
/// can be killed like a crash.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "helper process for killed_mid_download_resumes_on_restart"]
async fn crash_child() {
    let (Ok(url), Ok(dir)) = (std::env::var("CRASH_URL"), std::env::var("CRASH_DIR")) else { return };
    let dir = PathBuf::from(dir);
    let m = manager(&dir);
    set_cap(&m, 2048);
    m.add(AddRequest { url, dir: Some(dir.to_string_lossy().into()), connections: Some(4), start: true, ..Default::default() })
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_secs(120)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn killed_mid_download_resumes_on_restart() {
    let src = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let data = pattern(10 * MB, 7);
    std::fs::write(src.path().join("crash.bin"), &data).unwrap();
    let base = serve_dir(src.path().to_path_buf()).await;

    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["crash_child", "--exact", "--ignored", "--nocapture", "--test-threads=1"])
        .env("CRASH_URL", format!("{base}/crash.bin"))
        .env("CRASH_DIR", out.path())
        .env("BYTERUSH_CHECKPOINT_MS", "200")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let state = out.path().join("state.json");
    let started = Instant::now();
    while stored_progress(&state) < 2 * MB as u64 {
        assert!(started.elapsed() < Duration::from_secs(30), "the child never recorded progress");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    child.kill().unwrap(); // SIGKILL: no shutdown, no final save
    child.wait().unwrap();
    let recorded = stored_progress(&state);

    // a fresh start continues on its own from what the disk had, and the result is byte-exact
    let m = manager(out.path());
    set_cap(&m, 0);
    let id = m.snapshot(false)[0].record.id.clone();
    assert!(m.get(&id).unwrap().downloaded >= recorded.min(2 * MB as u64), "progress was lost");
    let done = wait_for(&m, &id, Status::Completed).await;
    assert_eq!(done.downloaded, data.len() as u64);
    assert!(std::fs::read(out.path().join("crash.bin")).unwrap() == data, "resumed file differs from the source");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn quitting_keeps_every_byte_and_continues_next_start() {
    let src = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let data = pattern(8 * MB, 3);
    std::fs::write(src.path().join("quit.bin"), &data).unwrap();
    let base = serve_dir(src.path().to_path_buf()).await;

    let m = manager(out.path());
    set_cap(&m, 3072);
    let id = m
        .add(AddRequest {
            url: format!("{base}/quit.bin"),
            dir: Some(out.path().to_string_lossy().into()),
            connections: Some(4),
            start: true,
            ..Default::default()
        })
        .await
        .unwrap();
    wait_for(&m, &id, Status::Downloading).await;
    tokio::time::sleep(Duration::from_millis(900)).await;
    let before = m.get(&id).unwrap().downloaded;
    m.shutdown(Duration::from_secs(3));
    let state = out.path().join("state.json");
    // what was received is synced and recorded, and the download is marked to continue
    assert!(stored_progress(&state) >= before, "{} < {before}", stored_progress(&state));
    assert_eq!(stored_status(&state), "queued");
    drop(m);

    let m = manager(out.path());
    set_cap(&m, 0);
    let done = wait_for(&m, &id, Status::Completed).await;
    assert_eq!(done.downloaded, data.len() as u64);
    assert!(std::fs::read(out.path().join("quit.bin")).unwrap() == data);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn file_replaced_on_server_while_paused_starts_over() {
    let src = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let path = src.path().join("nightly.bin");
    let v1 = pattern(6 * MB, 1);
    std::fs::write(&path, &v1).unwrap();
    let hour_ago = SystemTime::now() - Duration::from_secs(3600);
    std::fs::File::options().write(true).open(&path).unwrap().set_modified(hour_ago).unwrap();
    let base = serve_dir(src.path().to_path_buf()).await;

    let m = manager(out.path());
    set_cap(&m, 2048);
    let id = m
        .add(AddRequest {
            url: format!("{base}/nightly.bin"),
            dir: Some(out.path().to_string_lossy().into()),
            connections: Some(4),
            start: true,
            ..Default::default()
        })
        .await
        .unwrap();
    wait_for(&m, &id, Status::Downloading).await;
    tokio::time::sleep(Duration::from_millis(800)).await;
    m.pause(std::slice::from_ref(&id));
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(m.get(&id).unwrap().downloaded > 0);

    // a new build with the same size replaces the file
    let v2 = pattern(6 * MB, 2);
    std::fs::write(&path, &v2).unwrap();
    set_cap(&m, 0);
    m.resume(std::slice::from_ref(&id));
    wait_for(&m, &id, Status::Completed).await;
    assert!(std::fs::read(out.path().join("nightly.bin")).unwrap() == v2, "bytes of two versions were mixed");
}

/// A range-capable server for one in-memory file, with the restrictions real sites have.
#[derive(Clone)]
struct Site {
    data: Arc<Vec<u8>>,
    /// Refuse requests without a Referer from the site itself (hotlink protection).
    referer: bool,
    /// Refuse connections beyond this many at once (per-client caps); a test may raise it.
    cap: Arc<AtomicUsize>,
    inflight: Arc<AtomicUsize>,
    /// The most connections ever served at once.
    peak: Arc<AtomicUsize>,
    refused: Arc<AtomicUsize>,
    /// Pause per 256 KB chunk, to pace a connection.
    chunk_delay: Duration,
}

struct InFlight(Arc<AtomicUsize>);

impl Drop for InFlight {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

async fn site_file(State(site): State<Site>, headers: HeaderMap) -> Response {
    let referer = headers.get(header::REFERER).and_then(|v| v.to_str().ok()).unwrap_or("");
    if site.referer && !referer.starts_with("http://127.0.0.1") {
        return (StatusCode::FORBIDDEN, "hotlinking not allowed").into_response();
    }
    let inflight = site.inflight.fetch_add(1, Ordering::SeqCst) + 1;
    if inflight > site.cap.load(Ordering::SeqCst) {
        site.inflight.fetch_sub(1, Ordering::SeqCst);
        site.refused.fetch_add(1, Ordering::SeqCst);
        return (StatusCode::FORBIDDEN, "too many connections").into_response();
    }
    site.peak.fetch_max(inflight, Ordering::SeqCst);
    let guard = InFlight(site.inflight.clone());
    let total = site.data.len();
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("bytes="));
    let (start, end) = match range.and_then(|r| r.split_once('-')) {
        Some((a, b)) => (a.parse().unwrap(), if b.is_empty() { total } else { b.parse::<usize>().unwrap() + 1 }),
        None => (0, total),
    };
    // a short pause per chunk keeps several connections open at once; big chunks keep coarse
    // timers (about 15 ms on Windows) from stretching the test
    let chunks: Vec<Bytes> = site.data[start..end].chunks(256 * 1024).map(Bytes::copy_from_slice).collect();
    let delay = site.chunk_delay;
    let stream = futures_util::stream::iter(chunks).then(move |c| {
        let _held = &guard; // the connection counts until its body is done
        async move {
            tokio::time::sleep(delay).await;
            Ok::<_, std::io::Error>(c)
        }
    });
    let mut resp = Response::new(Body::from_stream(stream));
    let h = resp.headers_mut();
    h.insert(header::CONTENT_LENGTH, (end - start).into());
    h.insert(header::CONTENT_TYPE, "application/octet-stream".parse().unwrap());
    if range.is_some() {
        h.insert(header::CONTENT_RANGE, format!("bytes {start}-{}/{total}", end - 1).parse().unwrap());
        *resp.status_mut() = StatusCode::PARTIAL_CONTENT;
    }
    resp
}

async fn serve_site(site: Site) -> String {
    listen(axum::Router::new().route("/file.bin", axum::routing::get(site_file)).with_state(site)).await
}

fn site(data: &[u8], referer: bool, cap: usize) -> Site {
    Site {
        data: Arc::new(data.to_vec()),
        referer,
        cap: Arc::new(AtomicUsize::new(cap)),
        inflight: Arc::new(AtomicUsize::new(0)),
        peak: Arc::new(AtomicUsize::new(0)),
        refused: Arc::new(AtomicUsize::new(0)),
        chunk_delay: Duration::from_millis(1),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn hotlink_protection_gets_the_sites_referer() {
    let out = tempfile::tempdir().unwrap();
    let data = pattern(3 * MB, 9);
    let base = serve_site(site(&data, true, 64)).await;
    let m = manager(out.path());
    // the dialog's check gets past it too
    let probe = m.probe(&format!("{base}/file.bin")).await.unwrap();
    assert_eq!(probe.size, Some(data.len() as u64));
    let id = m
        .add(AddRequest {
            url: format!("{base}/file.bin"),
            dir: Some(out.path().to_string_lossy().into()),
            connections: Some(4),
            start: true,
            ..Default::default()
        })
        .await
        .unwrap();
    wait_for(&m, &id, Status::Completed).await;
    assert!(std::fs::read(out.path().join("file.bin")).unwrap() == data);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn per_client_connection_cap_does_not_stop_the_download() {
    let out = tempfile::tempdir().unwrap();
    let data = pattern(8 * MB, 5);
    let s = site(&data, false, 2);
    let refused = s.refused.clone();
    let base = serve_site(s).await;
    let m = manager(out.path());
    let started = Instant::now();
    let id = m
        .add(AddRequest {
            url: format!("{base}/file.bin"),
            dir: Some(out.path().to_string_lossy().into()),
            connections: Some(8),
            start: true,
            ..Default::default()
        })
        .await
        .unwrap();
    wait_for(&m, &id, Status::Completed).await;
    assert!(refused.load(Ordering::SeqCst) > 0, "the cap was never hit");
    // refused connections step aside at once, and the download doesn't wait for their next try
    assert!(started.elapsed() < Duration::from_secs(4), "took {:?}", started.elapsed());
    assert!(std::fs::read(out.path().join("file.bin")).unwrap() == data);
}

/// Hetzner, for one, serves two requests per client and answers the rest with 429 while they
/// last. The refused connections must come back when the server lets them, not leave the
/// download on one connection to the end.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn refused_connections_come_back_when_the_server_allows_them() {
    let out = tempfile::tempdir().unwrap();
    let data = pattern(48 * MB, 11);
    // one connection at a time, paced to about 12 MB/s: alone it needs some four seconds
    let mut s = site(&data, false, 1);
    s.chunk_delay = Duration::from_millis(20);
    let (cap, peak) = (s.cap.clone(), s.peak.clone());
    let base = serve_site(s).await;
    let m = manager(out.path());
    let id = m
        .add(AddRequest {
            url: format!("{base}/file.bin"),
            dir: Some(out.path().to_string_lossy().into()),
            connections: Some(8),
            start: true,
            ..Default::default()
        })
        .await
        .unwrap();
    // the first burst hits the cap; a moment later the server has room again
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(peak.load(Ordering::SeqCst), 1);
    cap.store(8, Ordering::SeqCst);
    wait_for(&m, &id, Status::Completed).await;
    assert!(peak.load(Ordering::SeqCst) > 1, "the refused connections never came back");
    assert!(std::fs::read(out.path().join("file.bin")).unwrap() == data);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn default_user_agent_is_the_apps_own() {
    let out = tempfile::tempdir().unwrap();
    let m = manager(out.path());
    let ua = m.settings().effective_user_agent();
    assert!(ua.starts_with("Byterush/") && !ua.starts_with("Mozilla"), "{ua}");
    // the old built-in value (posing as a browser) is replaced on load
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("state.json"),
        r#"{"settings":{"user_agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Byterush/0.2"}}"#,
    )
    .unwrap();
    assert_eq!(manager(dir.path()).settings().user_agent, "");
}

/// "Your download will start shortly" pages and login walls answer a file link with HTML.
async fn interstitial() -> Response {
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], "<html>Your download will start shortly...</html>").into_response()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_web_page_is_not_saved_as_the_file() {
    let out = tempfile::tempdir().unwrap();
    let base = listen(axum::Router::new().route("/setup.exe", axum::routing::get(interstitial))).await;
    let m = manager(out.path());
    let id = m
        .add(AddRequest {
            url: format!("{base}/setup.exe"),
            dir: Some(out.path().to_string_lossy().into()),
            start: true,
            ..Default::default()
        })
        .await
        .unwrap();
    for _ in 0..200 {
        if m.get(&id).unwrap().record.status == Status::Error {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let d = m.get(&id).unwrap();
    assert_eq!(d.record.status, Status::Error);
    assert!(d.record.error.as_deref().unwrap_or("").contains("web page"), "{:?}", d.record.error);
    assert!(!out.path().join("setup.exe").exists());
}
