//! A local file server with range support, for benchmarking the engine without a network:
//! `cargo run --release --example serve -- <dir> <port>` serves `<dir>/<name>` at `/<name>`,
//! streamed from disk (or tmpfs) in 1 MB reads, so the server is never the bottleneck.

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use std::path::PathBuf;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(args.next().expect("dir"));
    let port: u16 = args.next().expect("port").parse().unwrap();
    let app = axum::Router::new().route("/{name}", get(file)).with_state(dir);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    println!("READY");
    axum::serve(listener, app).await.unwrap();
}

async fn file(State(dir): State<PathBuf>, Path(name): Path<String>, headers: HeaderMap) -> Response {
    let Ok(mut f) = tokio::fs::File::open(dir.join(&name)).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let total = f.metadata().await.map(|m| m.len()).unwrap_or(0);
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("bytes="));
    let (start, end) = match range.and_then(|r| r.split_once('-')) {
        Some((a, b)) => {
            (a.parse().unwrap_or(0), if b.is_empty() { total } else { b.parse::<u64>().map(|e| e + 1).unwrap_or(total).min(total) })
        }
        None => (0, total),
    };
    if start >= end {
        return StatusCode::RANGE_NOT_SATISFIABLE.into_response();
    }
    if f.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let stream = futures_util::stream::unfold((f, end - start), |(mut f, left)| async move {
        if left == 0 {
            return None;
        }
        let mut buf: Vec<u8> = Vec::with_capacity((1 << 20).min(left as usize));
        match f.read_buf(&mut buf).await {
            Ok(0) | Err(_) => None,
            Ok(n) => Some((Ok::<_, std::io::Error>(buf), (f, left - n as u64))),
        }
    });
    let mut resp = Response::new(Body::from_stream(stream));
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
