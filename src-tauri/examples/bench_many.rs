//! Many-small-files benchmark: `cargo run --release --example bench_many -- [files] [max_active]`

use byterush_lib::engine::{AddRequest, Manager, Status};
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let files: usize = args.next().map(|a| a.parse().unwrap()).unwrap_or(500);
    let max_active: u8 = args.next().map(|a| a.parse().unwrap()).unwrap_or(3);

    let src = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    for i in 0..files {
        std::fs::write(src.path().join(format!("f{i:04}.bin")), vec![(i % 251) as u8; 48 * 1024]).unwrap();
    }
    let app = axum::Router::new().fallback_service(tower_http::services::ServeDir::new(src.path()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let manager = Manager::new(out.path().join("state.json"), out.path().to_path_buf(), tokio::runtime::Handle::current());
    let mut settings = manager.settings();
    settings.max_active = max_active;
    manager.update_settings(settings);

    let started = Instant::now();
    let requests = (0..files)
        .map(|i| AddRequest { url: format!("http://{addr}/f{i:04}.bin"), dir: Some(out.path().to_string_lossy().into()), start: true, ..Default::default() })
        .collect();
    let (ids, errors) = manager.add_many(requests).await;
    assert!(errors.is_empty(), "{errors:?}");
    let added = started.elapsed();
    loop {
        let done = manager.snapshot(false).iter().filter(|d| d.record.status == Status::Completed).count();
        if done == ids.len() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let total = started.elapsed();
    println!(
        "{files} files, max_active {max_active}: queued in {:.0} ms, all done in {:.2} s ({:.0} files/s)",
        added.as_secs_f64() * 1000.0,
        total.as_secs_f64(),
        files as f64 / total.as_secs_f64()
    );
}
