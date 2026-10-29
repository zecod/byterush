//! Headless download with the engine: `cargo run --example get -- <url> [out_dir] [connections]`

use byterush_lib::engine::{AddRequest, Manager, Status};
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let url = args.next().expect("usage: get <url> [out_dir] [connections]");
    let out = std::path::PathBuf::from(args.next().unwrap_or_else(|| ".".into()));
    let connections = args.next().map(|c| c.parse().expect("connections"));
    std::fs::create_dir_all(&out).unwrap();

    let manager = Manager::new(out.join("byterush-state.json"), out.clone(), tokio::runtime::Handle::current());
    let probe = manager.probe(&url).await.expect("probe");
    println!("{} | size {:?} | resumable {}", probe.file_name, probe.size, probe.resumable);

    let started = Instant::now();
    let id = manager
        .add(AddRequest {
            url,
            file_name: None,
            dir: Some(out.to_string_lossy().into()),
            connections,
            size: None,
            start: true,
            headers: Vec::new(),
            confirm: false,
        })
        .await
        .expect("add");
    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let d = manager.snapshot(false).into_iter().find(|d| d.record.id == id).unwrap();
        println!(
            "{:?} {:>6.1}% {:>8.2} MB/s  conns {}  refused {}  segments {}",
            d.record.status,
            d.record.size.map(|s| d.downloaded as f64 * 100.0 / s.max(1) as f64).unwrap_or(0.0),
            d.speed / 1_048_576.0,
            d.active_connections,
            d.refused_connections,
            d.segment_count
        );
        match d.record.status {
            Status::Completed => {
                println!("done in {:.1}s -> {}", started.elapsed().as_secs_f64(), out.join(&d.record.file_name).display());
                break;
            }
            Status::Error => {
                println!("error: {:?}", d.record.error);
                std::process::exit(1);
            }
            _ => {}
        }
    }
    let _ = std::fs::remove_file(out.join("byterush-state.json"));
}
