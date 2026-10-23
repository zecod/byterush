//! Browser hand-over through the local bridge: session headers, bot-check pages, origin checks.

use axum::http::{HeaderMap, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::get;
use byterush_lib::bridge;
use byterush_lib::engine::{Manager, Status};
use serde_json::{Value, json};
use std::sync::Arc;
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
}

async fn setup() -> Env {
    let app = axum::Router::new().route("/protected.bin", get(protected)).route("/challenge.bin", get(challenge));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let site = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let out = tempfile::tempdir().unwrap();
    let out_path = out.path().to_path_buf();
    let manager = Manager::new(out_path.join("state.json"), out_path.clone(), tokio::runtime::Handle::current());
    let port = free_port();
    let status = bridge::start_on(manager.clone(), &tokio::runtime::Handle::current(), Arc::new(|_: &str, _: &str| {}), port);
    for _ in 0..100 {
        if status.lock().unwrap().listening {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    Env { _out: out, out_path, manager, site, bridge: format!("http://127.0.0.1:{port}/v1") }
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
    let resp = req
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .unwrap();
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
