//! Local HTTP bridge for the browser extension.
//!
//! Listens on 127.0.0.1 only. Every call must carry `x-byterush-ext: <extension id>`: a web page
//! can't add a custom header to a cross-origin request without a CORS preflight, and preflights
//! are only answered for the extension. When an `Origin` is present it must be the extension too.

use crate::engine::{AddRequest, Expectation, Manager};
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const PORT: u16 = 51723;

/// Unpacked extension (fixed by the `key` in its manifest). Store builds get their own id.
pub const EXTENSION_IDS: &[&str] = &["alolkmfdhaifcmiheblachogjjenfdbk"];

/// How long the browser waits for our first response before keeping the download itself.
const VERDICT_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Serialize, Default)]
pub struct BridgeStatus {
    pub listening: bool,
    pub port: u16,
    pub error: Option<String>,
    pub extension_ids: Vec<String>,
}

/// Called after a download is taken over, e.g. to tell the UI.
pub type OnCaptured = Arc<dyn Fn(&str, &str) + Send + Sync>;

#[derive(Clone)]
struct Bridge {
    manager: Manager,
    on_captured: OnCaptured,
}

#[derive(Deserialize)]
struct BrowserDownload {
    url: String,
    file_name: Option<String>,
    mime: Option<String>,
    size: Option<u64>,
    #[serde(default)]
    headers: Vec<(String, String)>,
    /// "capture": the browser started it and is waiting for a verdict; "menu": the user picked
    /// "download with …" on a link.
    #[serde(default)]
    source: String,
}

#[derive(Serialize)]
struct Verdict {
    accepted: bool,
    id: Option<String>,
    file_name: Option<String>,
    reason: Option<String>,
}

#[derive(Serialize)]
struct Ping {
    app: &'static str,
    version: &'static str,
    capture: bool,
}

const CLIENT_HEADER: &str = "x-byterush-ext";

fn extension_origin(headers: &HeaderMap) -> Option<&HeaderValue> {
    let origin = headers.get(header::ORIGIN)?;
    let id = origin.to_str().ok()?.strip_prefix("chrome-extension://")?.trim_end_matches('/');
    EXTENSION_IDS.contains(&id).then_some(origin)
}

/// `Some(origin to echo)` when the caller is the extension.
fn authorized(headers: &HeaderMap) -> Option<Option<HeaderValue>> {
    let client = headers.get(CLIENT_HEADER)?.to_str().ok()?;
    if !EXTENSION_IDS.contains(&client) {
        return None;
    }
    match headers.get(header::ORIGIN) {
        None => Some(None),
        Some(_) => extension_origin(headers).map(|o| Some(o.clone())),
    }
}

fn with_cors(origin: Option<HeaderValue>, body: impl IntoResponse) -> Response {
    let mut resp = body.into_response();
    if let Some(origin) = origin {
        let h = resp.headers_mut();
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, OPTIONS"));
        h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("content-type, x-byterush-ext"));
        h.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    resp
}

async fn ping(State(bridge): State<Bridge>, headers: HeaderMap) -> Response {
    let Some(origin) = authorized(&headers) else { return StatusCode::FORBIDDEN.into_response() };
    with_cors(
        origin,
        Json(Ping { app: "byterush", version: env!("CARGO_PKG_VERSION"), capture: bridge.manager.browser_integration() }),
    )
}

async fn preflight(headers: HeaderMap) -> Response {
    match extension_origin(&headers) {
        Some(origin) => with_cors(Some(origin.clone()), StatusCode::NO_CONTENT),
        None => StatusCode::FORBIDDEN.into_response(),
    }
}

async fn download(State(bridge): State<Bridge>, headers: HeaderMap, Json(req): Json<BrowserDownload>) -> Response {
    let Some(origin) = authorized(&headers) else { return StatusCode::FORBIDDEN.into_response() };
    let reject = |reason: String| Json(Verdict { accepted: false, id: None, file_name: None, reason: Some(reason) });
    let accept = |id: String| {
        let file_name = bridge.manager.get(&id).map(|d| d.record.file_name);
        Json(Verdict { accepted: true, id: Some(id), file_name, reason: None })
    };

    if !matches!(url::Url::parse(&req.url).map(|u| u.scheme().to_string()).as_deref(), Ok("http" | "https")) {
        return with_cors(origin, reject("only http(s) links can be taken over".into()));
    }
    let expect = Expectation { size: req.size.filter(|s| *s > 0), mime: req.mime };
    // the same file as a paused or failed download (its link expired, typically): the browser's
    // fresh link continues that download instead of starting a second one from zero
    let resumable = match (&req.file_name, expect.size) {
        (Some(name), Some(size)) if req.source != "menu" && bridge.manager.browser_integration() => {
            bridge.manager.find_resumable(name, size)
        }
        _ => None,
    };
    let add = AddRequest {
        url: req.url,
        file_name: req.file_name,
        dir: None,
        connections: None,
        size: req.size,
        start: true,
        headers: req.headers,
    };

    if req.source == "menu" {
        // nothing is downloading in the browser: just queue it
        return match bridge.manager.add(add).await {
            Ok(id) => {
                (bridge.on_captured)(&id, "menu");
                with_cors(origin, accept(id))
            }
            Err(e) => with_cors(origin, reject(e)),
        };
    }

    if !bridge.manager.browser_integration() {
        return with_cors(origin, reject("browser integration is turned off in the app".into()));
    }
    let adopted = resumable.and_then(|id| {
        let (verdict, previous) = bridge.manager.adopt(&id, add.url.clone(), add.headers.clone(), expect.clone())?;
        Some((id, verdict, previous))
    });
    let (id, verdict, previous) = match adopted {
        Some((id, verdict, previous)) => (id, verdict, Some(previous)),
        None => match bridge.manager.add_watched(add, expect).await {
            Ok((id, verdict)) => (id, verdict, None),
            Err(e) => return with_cors(origin, reject(e)),
        },
    };
    let outcome = match tokio::time::timeout(VERDICT_TIMEOUT, verdict).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(reason))) => Err(reason),
        Ok(Err(_)) => Err("the download stopped before it started".into()),
        Err(_) => Err("the server took too long to answer".into()),
    };
    match outcome {
        Ok(()) => {
            (bridge.on_captured)(&id, "capture");
            with_cors(origin, accept(id))
        }
        Err(reason) => {
            match previous {
                // the browser keeps it; the earlier download stays as it was
                Some(previous) => bridge.manager.restore(&id, previous, reason.clone()),
                // the browser keeps it; drop our attempt and anything it wrote
                None => bridge.manager.remove(std::slice::from_ref(&id), true),
            }
            with_cors(origin, reject(reason))
        }
    }
}

/// Start the bridge on the app's runtime; the returned status reflects whether the port was free.
pub fn start(manager: Manager, runtime: &tokio::runtime::Handle, on_captured: OnCaptured) -> Arc<Mutex<BridgeStatus>> {
    start_on(manager, runtime, on_captured, PORT)
}

pub fn start_on(manager: Manager, runtime: &tokio::runtime::Handle, on_captured: OnCaptured, port: u16) -> Arc<Mutex<BridgeStatus>> {
    let status = Arc::new(Mutex::new(BridgeStatus {
        port,
        extension_ids: EXTENSION_IDS.iter().map(|s| s.to_string()).collect(),
        ..Default::default()
    }));
    let app = Router::new()
        .route("/v1/ping", get(ping))
        .route("/v1/download", post(download))
        .method_not_allowed_fallback(|method: Method, headers: HeaderMap| async move {
            if method == Method::OPTIONS { preflight(headers).await } else { StatusCode::METHOD_NOT_ALLOWED.into_response() }
        })
        .with_state(Bridge { manager, on_captured });

    let reported = status.clone();
    runtime.spawn(async move {
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => {
                reported.lock().unwrap().listening = true;
                if let Err(e) = axum::serve(listener, app).await {
                    let mut s = reported.lock().unwrap();
                    s.listening = false;
                    s.error = Some(e.to_string());
                }
            }
            Err(e) => reported.lock().unwrap().error = Some(format!("port {port} is busy: {e}")),
        }
    });
    status
}
