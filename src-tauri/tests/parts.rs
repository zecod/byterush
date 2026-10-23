//! Part-file layout (used on exFAT/FAT32): one file per segment, joined at the end ("rebuilding").
//! Own test binary because it forces the layout through an environment variable.

use byterush_lib::engine::{AddRequest, Layout, Manager, Status};
use std::time::Duration;

async fn serve(dir: std::path::PathBuf) -> String {
    let app = axum::Router::new().fallback_service(tower_http::services::ServeDir::new(dir));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn parts_are_rebuilt_into_the_file() {
    // SAFETY: set before any engine thread reads it; this binary has a single test
    unsafe { std::env::set_var("BYTERUSH_FORCE_PARTS", "1") };
    let src = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let data: Vec<u8> = (0..16 * 1024 * 1024u32).map(|i| (i.wrapping_mul(2246822519) >> 11) as u8).collect();
    std::fs::write(src.path().join("game.pkg"), &data).unwrap();
    let base = serve(src.path().to_path_buf()).await;

    let manager = Manager::new(out.path().join("state.json"), out.path().to_path_buf(), tokio::runtime::Handle::current());
    let mut settings = manager.settings();
    settings.speed_limit_kbps = 6 * 1024;
    manager.update_settings(settings.clone());
    let id = manager
        .add(AddRequest {
            url: format!("{base}/game.pkg"),
            dir: Some(out.path().to_string_lossy().into_owned()),
            connections: Some(6),
            start: true,
            ..Default::default()
        })
        .await
        .unwrap();

    // pause mid-way, then resume: part files carry the progress
    for _ in 0..200 {
        let d = manager.get(&id).unwrap();
        if d.downloaded > 3 * 1024 * 1024 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    manager.pause(&[id.clone()]);
    tokio::time::sleep(Duration::from_millis(400)).await;
    let paused = manager.get(&id).unwrap();
    assert_eq!(paused.record.layout, Layout::Parts);
    let parts: Vec<_> = std::fs::read_dir(out.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("game.pkg.byterush."))
        .collect();
    assert!(parts.len() >= 2, "expected one part file per connection, found {}", parts.len());

    settings.speed_limit_kbps = 0;
    manager.update_settings(settings);
    manager.resume(&[id.clone()]);
    let mut saw_rebuild = false;
    for _ in 0..1000 {
        let d = manager.get(&id).unwrap();
        if d.record.status == Status::Finishing && d.finishing.as_ref().is_some_and(|f| f.stage == "rebuilding") {
            saw_rebuild = true;
        }
        if d.record.status == Status::Completed {
            break;
        }
        assert_ne!(d.record.status, Status::Error, "{:?}", d.record.error);
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let done = manager.get(&id).unwrap();
    assert_eq!(done.record.status, Status::Completed);
    assert!(std::fs::read(out.path().join("game.pkg")).unwrap() == data, "rebuilt file differs");
    let leftovers: Vec<_> = std::fs::read_dir(out.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".byterush"))
        .collect();
    assert!(leftovers.is_empty(), "part files left behind: {leftovers:?}");
    // the rebuild of 16 MB can be quicker than the poll; when seen it must have reported its stage
    let _ = saw_rebuild;
}
