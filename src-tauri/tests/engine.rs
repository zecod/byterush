//! End-to-end: serve a file over HTTP with range support and download it with several connections.

use byterush_lib::engine::{AddRequest, Manager, Status};
use std::time::Duration;

async fn serve(dir: std::path::PathBuf) -> String {
    let app = axum::Router::new().fallback_service(tower_http::services::ServeDir::new(dir));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

async fn wait_for(manager: &Manager, id: &str, status: Status) -> byterush_lib::engine::DownloadView {
    for _ in 0..400 {
        let view = manager.snapshot(false).into_iter().find(|d| d.record.id == id).unwrap();
        if view.record.status == status {
            return view;
        }
        assert_ne!(view.record.status, Status::Error, "download failed: {:?}", view.record.error);
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("timed out waiting for {status:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn segmented_download_pause_resume() {
    let src = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let data: Vec<u8> = (0..12 * 1024 * 1024u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
    std::fs::write(src.path().join("big file.bin"), &data).unwrap();
    let base = serve(src.path().to_path_buf()).await;

    let manager = Manager::new(out.path().join("state.json"), out.path().to_path_buf(), tokio::runtime::Handle::current());
    let mut settings = manager.settings();
    settings.speed_limit_kbps = 4096; // slow enough to pause mid-way
    manager.update_settings(settings.clone());

    let probe = manager.probe(&format!("{base}/big%20file.bin")).await.unwrap();
    assert_eq!(probe.file_name, "big file.bin");
    assert_eq!(probe.size, Some(data.len() as u64));
    assert!(probe.resumable);

    let id = manager
        .add(AddRequest {
            url: probe.url.clone(),
            file_name: None,
            dir: Some(out.path().to_string_lossy().into_owned()),
            connections: Some(6),
            size: None,
            start: true,
            headers: Vec::new(),
            confirm: false,
        })
        .await
        .unwrap();

    wait_for(&manager, &id, Status::Downloading).await;
    tokio::time::sleep(Duration::from_millis(700)).await;
    manager.pause(std::slice::from_ref(&id));
    let paused = wait_for(&manager, &id, Status::Paused).await;
    assert!(paused.downloaded > 0 && paused.downloaded < data.len() as u64, "paused at {}", paused.downloaded);
    assert!(paused.segment_count >= 6);

    settings.speed_limit_kbps = 0;
    manager.update_settings(settings);
    manager.resume(std::slice::from_ref(&id));
    let done = wait_for(&manager, &id, Status::Completed).await;
    assert_eq!(done.downloaded, data.len() as u64);

    let written = std::fs::read(out.path().join("big file.bin")).unwrap();
    assert!(written == data, "downloaded bytes differ from the source");
    assert!(!out.path().join("big file.bin.byterush").exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn duplicate_names_get_numbered() {
    let src = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    std::fs::write(src.path().join("a.txt"), b"hello").unwrap();
    let base = serve(src.path().to_path_buf()).await;
    let manager = Manager::new(out.path().join("state.json"), out.path().to_path_buf(), tokio::runtime::Handle::current());
    let req = || AddRequest {
        url: format!("{base}/a.txt"),
        file_name: None,
        dir: Some(out.path().to_string_lossy().into_owned()),
        connections: None,
        size: None,
        start: true,
        headers: Vec::new(),
        confirm: false,
    };
    let a = manager.add(req()).await.unwrap();
    let b = manager.add(req()).await.unwrap();
    wait_for(&manager, &a, Status::Completed).await;
    let vb = wait_for(&manager, &b, Status::Completed).await;
    assert_eq!(vb.record.file_name, "a (1).txt");
    assert_eq!(std::fs::read(out.path().join("a (1).txt")).unwrap(), b"hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn many_files_through_temp_folder() {
    let src = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let temp = tempfile::tempdir().unwrap();
    for i in 0..60 {
        std::fs::write(src.path().join(format!("f{i:02}.bin")), vec![i as u8; 64 * 1024 + i]).unwrap();
    }
    let base = serve(src.path().to_path_buf()).await;
    let manager = Manager::new(out.path().join("state.json"), out.path().to_path_buf(), tokio::runtime::Handle::current());
    let mut settings = manager.settings();
    settings.temp_dir = temp.path().to_string_lossy().into_owned();
    settings.max_active = 8;
    manager.update_settings(settings);

    let requests = (0..60)
        .map(|i| AddRequest {
            url: format!("{base}/f{i:02}.bin"),
            dir: Some(out.path().to_string_lossy().into_owned()),
            start: true,
            ..Default::default()
        })
        .collect();
    let (ids, errors) = manager.add_many(requests).await;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(ids.len(), 60);
    for id in &ids {
        wait_for(&manager, id, Status::Completed).await;
    }
    for i in 0..60usize {
        let data = std::fs::read(out.path().join(format!("f{i:02}.bin"))).unwrap();
        assert_eq!(data, vec![i as u8; 64 * 1024 + i]);
    }
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0, "partial files left in the temp folder");
    let one = manager.get(&ids[0]).unwrap();
    assert!(one.record.part_path.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn quick_pause_resume_under_speed_cap() {
    let src = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let data: Vec<u8> = (0..4 * 1024 * 1024u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(src.path().join("capped.bin"), &data).unwrap();
    let base = serve(src.path().to_path_buf()).await;
    let manager = Manager::new(out.path().join("state.json"), out.path().to_path_buf(), tokio::runtime::Handle::current());
    let mut settings = manager.settings();
    settings.speed_limit_kbps = 1024;
    manager.update_settings(settings.clone());

    let id = manager
        .add(AddRequest {
            url: format!("{base}/capped.bin"),
            dir: Some(out.path().to_string_lossy().into_owned()),
            start: true,
            ..Default::default()
        })
        .await
        .unwrap();
    wait_for(&manager, &id, Status::Downloading).await;
    tokio::time::sleep(Duration::from_millis(600)).await;

    // pause shows immediately, even while connections sleep inside the limiter
    let started = std::time::Instant::now();
    manager.pause(std::slice::from_ref(&id));
    assert_eq!(manager.get(&id).unwrap().record.status, Status::Paused);
    // resuming right away must not be lost while the old connections close
    manager.resume(std::slice::from_ref(&id));
    settings.speed_limit_kbps = 0;
    manager.update_settings(settings);
    let done = wait_for(&manager, &id, Status::Completed).await;
    assert!(started.elapsed() < Duration::from_secs(8));
    assert_eq!(done.downloaded, data.len() as u64);
    assert!(std::fs::read(out.path().join("capped.bin")).unwrap() == data);
}

#[tokio::test]
async fn unreadable_state_is_kept_aside() {
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join("state.json");
    // a BOM is tolerated
    std::fs::write(&store, b"\xEF\xBB\xBF{\"settings\":{\"connections\":4},\"downloads\":[]}").unwrap();
    let m = Manager::new(store.clone(), dir.path().to_path_buf(), tokio::runtime::Handle::current());
    assert_eq!(m.settings().connections, 4);
    // garbage is backed up, not overwritten
    std::fs::write(&store, b"{ not json").unwrap();
    let _m = Manager::new(store.clone(), dir.path().to_path_buf(), tokio::runtime::Handle::current());
    let backups: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains("corrupt"))
        .collect();
    assert_eq!(backups.len(), 1);
    assert_eq!(std::fs::read(backups[0].path()).unwrap(), b"{ not json");
}
