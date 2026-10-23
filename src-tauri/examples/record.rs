//! Records a real download for the demo video: progress, speed, connections and every segment, ten
//! times a second, as JSON. Optionally pauses and resumes on the way.
//!
//! `cargo run --release --example record -- <url> <out_dir> <connections> <telemetry.json> [pause_s resume_s]`

use byterush_lib::engine::{AddRequest, Manager, Status};
use serde_json::json;
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let usage = "usage: record <url> <out_dir> <connections> <telemetry.json> [pause_s resume_s]";
    let url = args.next().expect(usage);
    let out = std::path::PathBuf::from(args.next().expect(usage));
    let connections: u8 = args.next().expect(usage).parse().expect("connections");
    let telemetry = std::path::PathBuf::from(args.next().expect(usage));
    let pause_at: Option<f64> = args.next().map(|s| s.parse().expect("pause_s"));
    let resume_at: Option<f64> = args.next().map(|s| s.parse().expect("resume_s"));
    std::fs::create_dir_all(&out).unwrap();

    let manager = Manager::new(out.join("record-state.json"), out.clone(), tokio::runtime::Handle::current());
    let mut settings = manager.settings();
    settings.category_subfolders = false;
    settings.connections = connections;
    manager.update_settings(settings);

    let started = Instant::now();
    let id = manager
        .add(AddRequest {
            url: url.clone(),
            dir: Some(out.to_string_lossy().into()),
            connections: Some(connections),
            start: true,
            ..Default::default()
        })
        .await
        .expect("add");
    let mut frames = Vec::new();
    let (mut paused, mut resumed) = (false, false);
    loop {
        let t = started.elapsed().as_secs_f64();
        if let Some(p) = pause_at
            && !paused
            && t >= p
        {
            manager.pause(std::slice::from_ref(&id));
            paused = true;
        }
        if let Some(r) = resume_at
            && paused
            && !resumed
            && t >= r
        {
            manager.resume(std::slice::from_ref(&id));
            resumed = true;
        }
        let d = manager.get(&id).unwrap();
        let segments: Vec<[u64; 3]> = d.record.segments.iter().map(|s| [s.start, s.end.min(u64::MAX >> 11), s.downloaded]).collect();
        frames.push(json!({
            "t": (t * 1000.0).round() / 1000.0,
            "status": d.record.status,
            "downloaded": d.downloaded,
            "speed": d.speed.round(),
            "active": d.active_connections,
            "segments": segments,
        }));
        match d.record.status {
            Status::Completed => break,
            Status::Error => panic!("download failed: {:?}", d.record.error),
            _ => {}
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let d = manager.get(&id).unwrap();
    let doc = json!({
        "url": url,
        "file_name": d.record.file_name,
        "size": d.record.size,
        "connections": connections,
        "seconds": started.elapsed().as_secs_f64(),
        "frames": frames,
    });
    std::fs::write(&telemetry, serde_json::to_vec(&doc).unwrap()).unwrap();
    println!(
        "{} in {:.1}s, {} frames -> {}",
        d.record.file_name,
        started.elapsed().as_secs_f64(),
        doc["frames"].as_array().unwrap().len(),
        telemetry.display()
    );
    let _ = std::fs::remove_file(out.join(&d.record.file_name));
    let _ = std::fs::remove_file(out.join("record-state.json"));
}
