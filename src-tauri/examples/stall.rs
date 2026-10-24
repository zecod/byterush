//! Measures how long the engine's status calls block while a big download starts — the UI calls
//! the same `snapshot` every 400 ms. `cargo run --example stall -- <url> <out_dir>`

use byterush_lib::engine::{AddRequest, Manager, Status};
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let url = args.next().expect("url");
    let out = std::path::PathBuf::from(args.next().expect("out dir"));
    std::fs::create_dir_all(&out).unwrap();
    let manager = Manager::new(out.join("state.json"), out.clone(), tokio::runtime::Handle::current());
    let id = manager
        .add(AddRequest { url, dir: Some(out.to_string_lossy().into()), connections: Some(8), start: true, ..Default::default() })
        .await
        .unwrap();

    let started = Instant::now();
    let mut worst = Duration::ZERO;
    while started.elapsed() < Duration::from_secs(20) {
        tokio::time::sleep(Duration::from_millis(200)).await;
        let m = manager.clone();
        let t = Instant::now();
        let view = tokio::task::spawn_blocking(move || m.snapshot(false)).await.unwrap();
        let took = t.elapsed();
        worst = worst.max(took);
        let d = view.iter().find(|d| d.record.id == id).unwrap();
        if took > Duration::from_millis(100) {
            println!(
                "{:>5.1}s  status call blocked {:>6} ms  ({:.1}% done)",
                started.elapsed().as_secs_f64(),
                took.as_millis(),
                d.downloaded as f64 * 100.0 / d.record.size.unwrap_or(1) as f64
            );
        }
        if d.record.status == Status::Completed {
            break;
        }
    }
    let d = manager.snapshot(false).into_iter().find(|d| d.record.id == id).unwrap();
    println!(
        "worst status call: {} ms; after 20 s: {:.1}% at {:.0} MB/s",
        worst.as_millis(),
        d.downloaded as f64 * 100.0 / d.record.size.unwrap_or(1) as f64,
        d.speed / 1e6
    );
    manager.remove(&[id], true);
    tokio::time::sleep(Duration::from_secs(2)).await;
}
