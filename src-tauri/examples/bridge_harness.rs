//! Pieces for testing the extension in a real browser, run as separate processes so the app can be
//! stopped while the site stays up:
//!
//! - `cargo run --example bridge_harness -- app <out_dir>`: the engine and the browser bridge on its
//!   usual port. Prints `READY` once listening and `CAPTURED <source> <id>` per hand-over.
//! - `cargo run --example bridge_harness -- site <site_dir> <port>`: serves `<site_dir>/page.html`
//!   and its files with range support. `/gz/<name>` answers browsers that accept gzip with
//!   `<name>.gz` and a Content-Length (like nginx's gzip_static), everyone else with the plain file.

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use byterush_lib::bridge;
use byterush_lib::engine::Manager;
use std::path::PathBuf;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("app") => app(PathBuf::from(args.next().expect("out_dir"))).await,
        Some("site") => {
            let dir = PathBuf::from(args.next().expect("site_dir"));
            site(dir, args.next().expect("port").parse().unwrap()).await
        }
        _ => panic!("usage: bridge_harness app <out_dir> | site <site_dir> <port>"),
    }
}

async fn app(out: PathBuf) {
    std::fs::create_dir_all(&out).unwrap();

    let manager = Manager::new(out.join("state.json"), out.clone(), tokio::runtime::Handle::current());
    let mut settings = manager.settings();
    settings.category_subfolders = false;
    manager.update_settings(settings);
    let status = bridge::start(
        manager.clone(),
        &tokio::runtime::Handle::current(),
        // the automated test has nobody to answer a "New download" window
        bridge::Hooks {
            on_captured: Arc::new(|id: &str, source: &str, _waiting: bool| println!("CAPTURED {source} {id}")),
            can_ask: false,
        },
    );

    for _ in 0..200 {
        if status.lock().unwrap().listening {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    println!("READY {}", status.lock().unwrap().listening);
    std::future::pending::<()>().await;
}

async fn site(dir: PathBuf, port: u16) {
    let app =
        axum::Router::new().route("/page.html", get(page)).route("/f/{name}", get(plain)).route("/gz/{name}", get(gzipped)).with_state(dir);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    println!("READY");
    axum::serve(listener, app).await.unwrap();
}

async fn page(State(site): State<PathBuf>) -> Response {
    let html = std::fs::read_to_string(site.join("page.html")).unwrap_or_default();
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response()
}

async fn plain(State(site): State<PathBuf>, Path(name): Path<String>, headers: HeaderMap) -> Response {
    match std::fs::read(site.join(&name)) {
        Ok(data) => ranged(data, &headers),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn gzipped(State(site): State<PathBuf>, Path(name): Path<String>, headers: HeaderMap) -> Response {
    let accepts = headers.get(header::ACCEPT_ENCODING).and_then(|v| v.to_str().ok()).is_some_and(|v| v.contains("gzip"));
    if accepts && let Ok(gz) = std::fs::read(site.join(format!("{name}.gz"))) {
        let mut resp = Response::new(Body::from(gz.clone()));
        let h = resp.headers_mut();
        h.insert(header::CONTENT_ENCODING, "gzip".parse().unwrap());
        h.insert(header::CONTENT_LENGTH, gz.len().into());
        h.insert(header::CONTENT_TYPE, "text/plain".parse().unwrap());
        return resp;
    }
    plain(State(site), Path(name), headers).await
}

fn ranged(data: Vec<u8>, headers: &HeaderMap) -> Response {
    let total = data.len();
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("bytes="));
    let (start, end) = match range.and_then(|r| r.split_once('-')) {
        Some((a, b)) => (a.parse().unwrap_or(0), if b.is_empty() { total } else { b.parse::<usize>().unwrap_or(total - 1) + 1 }),
        None => (0, total),
    };
    let mut resp = Response::new(Body::from(data[start..end].to_vec()));
    let h = resp.headers_mut();
    h.insert(header::CONTENT_LENGTH, (end - start).into());
    h.insert(header::CONTENT_TYPE, "application/octet-stream".parse().unwrap());
    h.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    if range.is_some() {
        h.insert(header::CONTENT_RANGE, format!("bytes {start}-{}/{total}", end - 1).parse().unwrap());
        *resp.status_mut() = StatusCode::PARTIAL_CONTENT;
    }
    resp
}
