//! Browser hand-over through the local bridge: session headers, bot-check pages, origin checks,
//! and the "New download" window that asks before a hand-over goes on.

use axum::http::{HeaderMap, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::get;
use byterush_lib::bridge;
use byterush_lib::engine::{Confirmation, Manager, Status};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const EXT_ID: &str = "alolkmfdhaifcmiheblachogjjenfdbk";
const EXT_ORIGIN: &str = "chrome-extension://alolkmfdhaifcmiheblachogjjenfdbk";
const FILE: &[u8] = b"the real file contents, 40 bytes long!!!";

/// A site behind a bot check: the file is only served with the clearance cookie and the same UA.
async fn protected(headers: HeaderMap) -> impl IntoResponse {
    let cookie = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()).unwrap_or("");
    let ua = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("");
    if cookie.contains("cf_clearance=ok") && ua == "TestBrowser/1.0" {
        ([(header::CONTENT_TYPE, "application/octet-stream")], FILE).into_response()
    } else {
        (StatusCode::FORBIDDEN, "blocked").into_response()
    }
}

async fn challenge() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], "<html>Just a moment...</html>")
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

struct Env {
    _out: tempfile::TempDir,
    out_path: std::path::PathBuf,
    manager: Manager,
    site: String,
    bridge: String,
    /// (id, source, waiting) of every hand-over, as the app is told.
    captured: Arc<Mutex<Vec<(String, String, bool)>>>,
    /// Requests for `/once.bin`.
    once_hits: Arc<AtomicUsize>,
    /// (file name, reason) of every download the browser had to keep.
    declined: Arc<Mutex<Vec<(String, String)>>>,
    status: Arc<Mutex<bridge::BridgeStatus>>,
}

async fn setup() -> Env {
    setup_with(false).await
}

/// `can_ask`: the app shows the "New download" window.
async fn setup_with(can_ask: bool) -> Env {
    let once_hits = Arc::new(AtomicUsize::new(0));
    let hits = once_hits.clone();
    // a link that works once, like the one-time links of some file hosts
    let once = move || {
        let first = hits.fetch_add(1, Ordering::SeqCst) == 0;
        async move {
            if first {
                ([(header::CONTENT_TYPE, "application/octet-stream")], FILE).into_response()
            } else {
                (StatusCode::GONE, "this link was used").into_response()
            }
        }
    };
    let app =
        axum::Router::new().route("/protected.bin", get(protected)).route("/challenge.bin", get(challenge)).route("/once.bin", get(once));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let site = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let out = tempfile::tempdir().unwrap();
    let out_path = out.path().to_path_buf();
    let manager = Manager::new(out_path.join("state.json"), out_path.clone(), tokio::runtime::Handle::current());
    let port = free_port();
    let captured = Arc::new(Mutex::new(Vec::new()));
    let log = captured.clone();
    let on_captured = Arc::new(move |id: &str, source: &str, waiting: bool| log.lock().unwrap().push((id.into(), source.into(), waiting)));
    let declined = Arc::new(Mutex::new(Vec::new()));
    let kept = declined.clone();
    let on_declined = Arc::new(move |name: &str, reason: &str| kept.lock().unwrap().push((name.to_string(), reason.to_string())));
    let status =
        bridge::start_on(manager.clone(), &tokio::runtime::Handle::current(), bridge::Hooks { on_captured, on_declined, can_ask }, port);
    for _ in 0..100 {
        if status.lock().unwrap().listening {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    Env { _out: out, out_path, manager, site, bridge: format!("http://127.0.0.1:{port}/v1"), captured, once_hits, declined, status }
}

async fn hand_over(env: &Env, origin: &str, body: Value) -> (StatusCode, Value) {
    send(env, Some(origin), Some(EXT_ID), body).await
}

async fn send(env: &Env, origin: Option<&str>, client: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut req = reqwest::Client::new().post(format!("{}/download", env.bridge));
    if let Some(origin) = origin {
        req = req.header("origin", origin);
    }
    if let Some(client) = client {
        req = req.header("x-byterush-ext", client);
    }
    let resp = req.header("content-type", "application/json").body(body.to_string()).send().await.unwrap();
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap();
    (status, serde_json::from_str(&resp.text().await.unwrap()).unwrap_or(Value::Null))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn protected_download_uses_browser_session() {
    let env = setup().await;
    let (status, verdict) = hand_over(
        &env,
        EXT_ORIGIN,
        json!({
            "url": format!("{}/protected.bin", env.site),
            "file_name": "protected.bin",
            "mime": "application/octet-stream",
            "size": FILE.len(),
            "headers": [["Cookie", "cf_clearance=ok; other=1"], ["User-Agent", "TestBrowser/1.0"], ["Accept-Encoding", "gzip"], ["Range", "bytes=5-"]],
            "source": "capture"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(verdict["accepted"], true, "{verdict}");
    let id = verdict["id"].as_str().unwrap().to_string();
    for _ in 0..200 {
        if env.manager.get(&id).unwrap().record.status == Status::Completed {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(std::fs::read(env.out_path.join("protected.bin")).unwrap(), FILE);
    // session cookies are dropped once the download is done (the save follows completion)
    let mut saved = String::new();
    for _ in 0..100 {
        saved = std::fs::read_to_string(env.out_path.join("state.json")).unwrap_or_default();
        if !saved.contains("cf_clearance") && saved.contains("completed") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(!saved.contains("cf_clearance"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn without_session_the_browser_keeps_it() {
    let env = setup().await;
    let (_, verdict) = hand_over(
        &env,
        EXT_ORIGIN,
        json!({ "url": format!("{}/protected.bin", env.site), "file_name": "protected.bin", "headers": [], "source": "capture" }),
    )
    .await;
    assert_eq!(verdict["accepted"], false);
    assert!(verdict["reason"].as_str().unwrap().contains("403"), "{verdict}");
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(env.manager.snapshot(false).is_empty(), "rejected attempt must be removed");
    // and the app hears about it
    let declined = env.declined.lock().unwrap().clone();
    assert_eq!(declined.len(), 1);
    assert_eq!(declined[0].0, "protected.bin");
    assert!(declined[0].1.contains("403"), "{declined:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bot_check_page_is_not_taken() {
    let env = setup().await;
    let (_, verdict) = hand_over(
        &env,
        EXT_ORIGIN,
        json!({ "url": format!("{}/challenge.bin", env.site), "file_name": "challenge.bin", "mime": "application/zip", "size": 1000, "source": "capture" }),
    )
    .await;
    assert_eq!(verdict["accepted"], false);
    assert!(verdict["reason"].as_str().unwrap().contains("web page"), "{verdict}");
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(env.manager.snapshot(false).is_empty());
    assert!(!env.out_path.join("challenge.bin").exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn other_origins_are_refused() {
    let env = setup().await;
    let body = json!({ "url": format!("{}/protected.bin", env.site), "source": "menu" });
    let (status, _) = hand_over(&env, "https://evil.example", body.clone()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = hand_over(&env, "chrome-extension://someotherextensionidxxxxxxxxxxxx", body.clone()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // no client header (a plain cross-site form post), or a wrong one
    let (status, _) = send(&env, None, None, body.clone()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send(&env, None, Some("someotherextensionidxxxxxxxxxxxx"), body.clone()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(env.manager.snapshot(false).is_empty());
    // the extension's own GET carries no Origin, only the client header
    let (status, _) = send(&env, None, Some(EXT_ID), body).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn expired_link_is_continued_from_the_browser() {
    use axum::extract::Request;
    use axum::middleware::Next;
    use std::sync::atomic::{AtomicBool, Ordering};

    let src = tempfile::tempdir().unwrap();
    let data: Vec<u8> = (0..6 * 1024 * 1024u32).map(|i| (i.wrapping_mul(2654435761) >> 9) as u8).collect();
    std::fs::write(src.path().join("big.bin"), &data).unwrap();
    let expired = Arc::new(AtomicBool::new(false));
    let gate = expired.clone();
    let app = axum::Router::new()
        .nest_service("/old", tower_http::services::ServeDir::new(src.path()))
        .nest_service("/new", tower_http::services::ServeDir::new(src.path()))
        .route("/challenge/big.bin", get(challenge))
        .layer(axum::middleware::from_fn(move |req: Request, next: Next| {
            let gate = gate.clone();
            async move {
                if gate.load(Ordering::SeqCst) && req.uri().path().starts_with("/old") {
                    return (StatusCode::FORBIDDEN, "link expired").into_response();
                }
                next.run(req).await
            }
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let site = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let env = setup().await;
    let m = &env.manager;

    let mut settings = m.settings();
    settings.speed_limit_kbps = 2048;
    m.update_settings(settings.clone());
    let id = m
        .add(byterush_lib::engine::AddRequest {
            url: format!("{site}/old/big.bin"),
            dir: Some(env.out_path.to_string_lossy().into()),
            connections: Some(4),
            start: true,
            ..Default::default()
        })
        .await
        .unwrap();
    wait_status(m, &id, Status::Downloading).await;
    tokio::time::sleep(Duration::from_millis(700)).await;
    m.pause(std::slice::from_ref(&id));
    tokio::time::sleep(Duration::from_millis(300)).await;
    let progress = m.get(&id).unwrap().downloaded;
    assert!(progress > 0);

    // the link expires: resuming reports it plainly and keeps the progress
    expired.store(true, Ordering::SeqCst);
    m.resume(std::slice::from_ref(&id));
    let failed = wait_status(m, &id, Status::Error).await;
    assert!(failed.record.error.as_deref().unwrap_or("").contains("403"), "{:?}", failed.record.error);
    assert_eq!(failed.downloaded, progress);

    let body = |url: String| json!({ "url": url, "file_name": "big.bin", "mime": "application/octet-stream", "size": data.len(), "headers": [], "source": "capture" });
    // a bot check from the browser's new link must not touch the existing download
    let (_, verdict) = hand_over(&env, EXT_ORIGIN, body(format!("{site}/challenge/big.bin"))).await;
    assert_eq!(verdict["accepted"], false, "{verdict}");
    let kept = m.get(&id).unwrap();
    assert!(kept.record.url.ends_with("/old/big.bin"));
    assert_eq!(kept.downloaded, progress);

    // the user clicks the link again in the browser: the same download continues from there
    let (_, verdict) = hand_over(&env, EXT_ORIGIN, body(format!("{site}/new/big.bin"))).await;
    assert_eq!(verdict["accepted"], true, "{verdict}");
    assert_eq!(verdict["id"], id.as_str(), "a second download was started");
    assert!(m.get(&id).unwrap().downloaded >= progress);
    settings.speed_limit_kbps = 0;
    m.update_settings(settings);
    wait_status(m, &id, Status::Completed).await;
    assert_eq!(m.snapshot(false).len(), 1);
    assert!(std::fs::read(env.out_path.join("big.bin")).unwrap() == data);
}

async fn wait_status(m: &Manager, id: &str, status: Status) -> byterush_lib::engine::DownloadView {
    for _ in 0..400 {
        let d = m.get(id).unwrap();
        if d.record.status == status {
            return d;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("timed out waiting for {status:?}");
}

async fn get_ping(env: &Env) -> Value {
    let resp = reqwest::Client::new().get(format!("{}/ping", env.bridge)).header("x-byterush-ext", EXT_ID).send().await.unwrap();
    serde_json::from_str(&resp.text().await.unwrap()).unwrap()
}

fn once_body(env: &Env) -> Value {
    json!({ "url": format!("{}/once.bin", env.site), "file_name": "once.bin", "mime": "application/octet-stream", "size": FILE.len(), "headers": [], "source": "capture" })
}

/// Files the download left in a folder, besides the app's own state.
fn files_in(dir: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|it| it.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default();
    names.retain(|n| !n.starts_with("state.json"));
    names.sort();
    names
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_hand_over_waits_for_the_answer_and_goes_where_the_user_chose() {
    let env = setup_with(true).await;
    let (_, verdict) = hand_over(&env, EXT_ORIGIN, once_body(&env)).await;
    // the browser lets go as soon as the file is confirmed to be the same; the user decides after
    assert_eq!(verdict["accepted"], true, "{verdict}");
    let id = verdict["id"].as_str().unwrap().to_string();
    assert_eq!(env.captured.lock().unwrap().as_slice(), &[(id.clone(), "capture".to_string(), true)]);
    let waiting = wait_status(&env.manager, &id, Status::Waiting).await;
    assert_eq!(waiting.record.size, Some(FILE.len() as u64));
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(env.manager.get(&id).unwrap().record.status, Status::Waiting);
    assert!(files_in(&env.out_path).is_empty(), "nothing is written before the answer: {:?}", files_in(&env.out_path));

    let chosen = env.out_path.join("chosen");
    let name = env
        .manager
        .confirm(
            &id,
            Confirmation {
                file_name: Some("kept.bin".into()),
                dir: Some(chosen.to_string_lossy().into()),
                connections: Some(4),
                start: true,
            },
        )
        .unwrap();
    assert_eq!(name, "kept.bin");
    wait_status(&env.manager, &id, Status::Completed).await;
    assert_eq!(std::fs::read(chosen.join("kept.bin")).unwrap(), FILE);
    // the link was used once: the held first response carried the file
    assert_eq!(env.once_hits.load(Ordering::SeqCst), 1);
    // answered already
    assert!(env.manager.confirm(&id, Confirmation::default()).is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn later_keeps_it_paused_and_cancel_leaves_nothing() {
    let env = setup_with(true).await;
    let body = |name: &str| {
        json!({
            "url": format!("{}/protected.bin", env.site),
            "file_name": name,
            "size": FILE.len(),
            "headers": [["Cookie", "cf_clearance=ok"], ["User-Agent", "TestBrowser/1.0"]],
            "source": "capture"
        })
    };
    let (_, later) = hand_over(&env, EXT_ORIGIN, body("later.bin")).await;
    let later = later["id"].as_str().unwrap().to_string();
    wait_status(&env.manager, &later, Status::Waiting).await;
    // "download later", or the window closed without an answer
    env.manager.confirm(&later, Confirmation::default()).unwrap();
    wait_status(&env.manager, &later, Status::Paused).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(env.manager.get(&later).unwrap().record.status, Status::Paused);
    env.manager.resume(std::slice::from_ref(&later));
    wait_status(&env.manager, &later, Status::Completed).await;
    assert_eq!(std::fs::read(env.out_path.join("later.bin")).unwrap(), FILE);

    let (_, cancel) = hand_over(&env, EXT_ORIGIN, body("cancel.bin")).await;
    let cancel = cancel["id"].as_str().unwrap().to_string();
    wait_status(&env.manager, &cancel, Status::Waiting).await;
    env.manager.remove(std::slice::from_ref(&cancel), true);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(env.manager.get(&cancel).is_none());
    assert_eq!(files_in(&env.out_path), vec!["later.bin".to_string()]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn quitting_while_it_waits_brings_it_back_paused() {
    let env = setup_with(true).await;
    let (_, verdict) = hand_over(&env, EXT_ORIGIN, once_body(&env)).await;
    let id = verdict["id"].as_str().unwrap().to_string();
    wait_status(&env.manager, &id, Status::Waiting).await;
    env.manager.shutdown(Duration::from_secs(1));
    // continuing running downloads on start is on, but this one never got its answer
    assert!(env.manager.settings().resume_on_startup);
    let reopened = Manager::new(env.out_path.join("state.json"), env.out_path.clone(), tokio::runtime::Handle::current());
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(reopened.get(&id).unwrap().record.status, Status::Paused);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn with_asking_turned_off_it_goes_on_right_away() {
    let env = setup_with(true).await;
    let mut settings = env.manager.settings();
    settings.ask_before_download = false;
    env.manager.update_settings(settings);
    let (_, verdict) = hand_over(&env, EXT_ORIGIN, once_body(&env)).await;
    let id = verdict["id"].as_str().unwrap().to_string();
    wait_status(&env.manager, &id, Status::Completed).await;
    assert!(!env.captured.lock().unwrap()[0].2);
    assert_eq!(std::fs::read(env.out_path.join("once.bin")).unwrap(), FILE);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_busy_server_is_asked_again_instead_of_leaving_it_to_the_browser() {
    // "too many requests" (come back in a second), then a gateway hiccup, then the file
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    let app = axum::Router::new().route(
        "/busy.bin",
        get(move || {
            let n = counter.fetch_add(1, Ordering::SeqCst);
            async move {
                match n {
                    0 => (StatusCode::TOO_MANY_REQUESTS, [(header::RETRY_AFTER, "1")], "slow down").into_response(),
                    1 => (StatusCode::SERVICE_UNAVAILABLE, "busy").into_response(),
                    _ => ([(header::CONTENT_TYPE, "application/octet-stream")], FILE).into_response(),
                }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let site = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let env = setup().await;

    let started = std::time::Instant::now();
    let (_, verdict) = hand_over(
        &env,
        EXT_ORIGIN,
        json!({ "url": format!("{site}/busy.bin"), "file_name": "busy.bin", "size": FILE.len(), "headers": [], "source": "capture" }),
    )
    .await;
    assert_eq!(verdict["accepted"], true, "{verdict}");
    assert!(started.elapsed() >= Duration::from_secs(1), "Retry-After is honoured");
    assert!(started.elapsed() < Duration::from_secs(8));
    let id = verdict["id"].as_str().unwrap().to_string();
    wait_status(&env.manager, &id, Status::Completed).await;
    assert_eq!(std::fs::read(env.out_path.join("busy.bin")).unwrap(), FILE);
    assert!(hits.load(Ordering::SeqCst) >= 3);
    assert!(env.declined.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn small_files_are_left_to_the_browser_when_set() {
    let env = setup().await;
    let body = |source: &str, size: Option<usize>| json!({ "url": format!("{}/once.bin", env.site), "file_name": "once.bin", "size": size, "headers": [], "source": source });
    // off by default: everything is taken
    let ping = get_ping(&env).await;
    assert_eq!(ping["min_size"], 0);

    let mut settings = env.manager.settings();
    settings.leave_small_to_browser = true;
    settings.small_file_limit_mb = 1;
    env.manager.update_settings(settings);
    let ping = get_ping(&env).await;
    assert_eq!(ping["min_size"], 1024 * 1024);

    // the browser knows the size: no request at all
    let (_, verdict) = hand_over(&env, EXT_ORIGIN, body("capture", Some(FILE.len()))).await;
    assert_eq!(verdict["accepted"], false);
    assert!(verdict["reason"].as_str().unwrap().contains("smaller than 1 MB"), "{verdict}");
    assert_eq!(env.once_hits.load(Ordering::SeqCst), 0);

    // it doesn't: the first response tells, and the attempt is dropped
    let (_, verdict) = hand_over(&env, EXT_ORIGIN, body("capture", None)).await;
    assert_eq!(verdict["accepted"], false, "{verdict}");
    assert!(verdict["reason"].as_str().unwrap().contains("smaller than 1 MB"), "{verdict}");
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(env.manager.snapshot(false).is_empty());
    assert!(files_in(&env.out_path).is_empty(), "{:?}", files_in(&env.out_path));
    // the user's own rule, not a failure to report
    assert!(env.declined.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_link_picked_from_the_menu_is_taken_whatever_its_size() {
    let env = setup().await;
    let mut settings = env.manager.settings();
    settings.leave_small_to_browser = true;
    settings.small_file_limit_mb = 1;
    env.manager.update_settings(settings);
    let (_, verdict) =
        hand_over(&env, EXT_ORIGIN, json!({ "url": format!("{}/once.bin", env.site), "size": FILE.len(), "source": "menu" })).await;
    assert_eq!(verdict["accepted"], true, "{verdict}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_extension_checking_in_is_remembered() {
    let env = setup().await;
    assert!(env.status.lock().unwrap().extension_seen_ms.is_none());
    let resp = reqwest::Client::new()
        .get(format!("{}/ping", env.bridge))
        .header("x-byterush-ext", EXT_ID)
        .header("x-byterush-browser", "Microsoft Edge")
        .header("x-byterush-ext-version", "0.3.0")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 200);
    let status = env.status.lock().unwrap().clone();
    assert!(status.extension_seen_ms.is_some());
    assert_eq!(status.extension_browser.as_deref(), Some("Microsoft Edge"));
    assert_eq!(status.extension_version.as_deref(), Some("0.3.0"));
}
