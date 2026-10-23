//! How the end of a big download behaves: `cargo run --example tail -- <url> <out_dir> [connections]`
//! Prints overall progress, then every segment once a second from 95 % on.

use byterush_lib::engine::{AddRequest, Manager, Status};
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let url = args.next().expect("usage: tail <url> <out_dir> [connections]");
    let out = std::path::PathBuf::from(args.next().expect("out_dir"));
    let connections = args.next().map(|c| c.parse().expect("connections"));
    std::fs::create_dir_all(&out).unwrap();

    let manager = Manager::new(out.join("byterush-state.json"), out.clone(), tokio::runtime::Handle::current());
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
        })
        .await
        .expect("add");
    let mut last_print = 0u64;
    loop {
        tokio::time::sleep(Duration::from_millis(250)).await;
        let t = started.elapsed().as_secs_f64();
        let d = manager.snapshot(true).into_iter().find(|d| d.record.id == id).unwrap();
        let pct = d.record.size.map(|s| d.downloaded as f64 * 100.0 / s.max(1) as f64).unwrap_or(0.0);
        let second = t as u64;
        if second != last_print && (pct >= 95.0 || second.is_multiple_of(10)) {
            last_print = second;
            println!("{t:6.1}s {:?} {pct:6.2}% {:7.2} MB/s conns {}", d.record.status, d.speed / 1_048_576.0, d.active_connections);
            if pct >= 95.0 {
                for (i, s) in d.record.segments.iter().filter(|s| s.remaining() > 0).enumerate() {
                    let age = s.rate_at.map(|a| a.elapsed().as_secs_f64()).unwrap_or(f64::NAN);
                    println!(
                        "         seg {i:2} left {:8.2} MB  rate {:6.2} MB/s  quiet {age:4.1}s  claimed {}",
                        s.remaining() as f64 / 1_048_576.0,
                        s.rate as f64 / 1_048_576.0,
                        s.claimed
                    );
                }
            }
        }
        match d.record.status {
            Status::Completed => {
                println!("done in {t:.1}s");
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
