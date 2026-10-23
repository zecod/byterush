//! The state file only records progress that is already synced to disk, from the very first
//! moment of a download. Own test binary because it sets the checkpoint interval process-wide.

use byterush_lib::engine::{AddRequest, Manager, Status};
use std::time::Duration;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn nothing_unsynced_is_recorded_before_the_first_checkpoint() {
    // SAFETY: set before any engine thread reads it; this binary has a single test
    unsafe { std::env::set_var("BYTERUSH_CHECKPOINT_MS", "600000") };
    let src = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    std::fs::write(src.path().join("slow.bin"), vec![7u8; 8 * 1024 * 1024]).unwrap();
    let app = axum::Router::new().fallback_service(tower_http::services::ServeDir::new(src.path()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let m = Manager::new(out.path().join("state.json"), out.path().to_path_buf(), tokio::runtime::Handle::current());
    let mut settings = m.settings();
    settings.speed_limit_kbps = 2048;
    m.update_settings(settings);
    let id = m
        .add(AddRequest {
            url: format!("{base}/slow.bin"),
            dir: Some(out.path().to_string_lossy().into()),
            connections: Some(4),
            start: true,
            ..Default::default()
        })
        .await
        .unwrap();
    for _ in 0..200 {
        if m.get(&id).unwrap().downloaded > 1024 * 1024 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(m.get(&id).unwrap().record.status, Status::Downloading);
    m.save();
    let state: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(out.path().join("state.json")).unwrap()).unwrap();
    let recorded: u64 = state["downloads"][0]["segments"].as_array().unwrap().iter().map(|s| s["downloaded"].as_u64().unwrap()).sum();
    assert!(m.get(&id).unwrap().downloaded > 0);
    assert_eq!(recorded, 0, "the state claimed bytes that were never synced");
}
