use std::{
    fs::OpenOptions,
    io::Write,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use axum::{
    Json,
    body::Bytes,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use once_cell::sync::Lazy;
use serde_json::{Value, json};
use tokio::fs;

use crate::util::{Events, clean_logs, get_events};
static STORAGE_PATH: Lazy<String> = Lazy::new(|| "Storage".to_string());
pub async fn get_logs(path: &str, is_running: Arc<AtomicBool>) -> Response {
    while is_running.load(Ordering::Relaxed) {}
    let events = get_events(path);
    if events.is_some() {
        (StatusCode::OK, Json(events.unwrap())).into_response()
    } else {
        (StatusCode::NO_CONTENT).into_response()
    }
}

pub async fn post_logs(is_running: Arc<AtomicBool>, Json(events): Json<Events>) -> Response {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open("logs.toml")
        .unwrap();
    for e in events.events {
        let _ = file.write(e.print().as_bytes());
    }
    is_running.store(true, Ordering::Relaxed);
    clean_logs("logs.toml");
    tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
    is_running.store(false, Ordering::Relaxed);

    (
        StatusCode::OK,
        Json(json!({"status":"ok", "message":"Logs Received"})),
    )
        .into_response()
}

pub async fn get_file(Path(file_path): Path<String>) -> Response{
    let file_path = format!("{}/{}", &STORAGE_PATH.as_str(), file_path);
    let data = fs::read(file_path).await.unwrap();
    (StatusCode::OK, data).into_response()
}

pub async fn delete_file(Path(file_path): Path<String>) -> Response {
    let file_path = format!("{}/{}", &STORAGE_PATH.as_str(), file_path);
    let meta = tokio::fs::metadata(&file_path).await;
    if meta.is_err() {
       return StatusCode::NOT_FOUND.into_response()
    }

    let meta = meta.unwrap();
    if meta.is_dir() {
        tokio::fs::remove_dir_all(&file_path).await.unwrap();
    } else {
        tokio::fs::remove_file(&file_path).await.unwrap();
    }

    StatusCode::OK.into_response()
}

pub async fn rename_file(Json(payload): Json<Value>) {
    let old = payload.get("from").unwrap().as_str().unwrap();
    let new = payload.get("to").unwrap().as_str().unwrap();
    let old = format!("{}/{}", &STORAGE_PATH.as_str(), old);
    let new = format!("{}/{}", &STORAGE_PATH.as_str(), new);
    let _ = fs::rename(&old, &new);
}

pub async fn post_file(Path(file_path): Path<String>, body: Bytes) {
    let mut file_path = file_path;

    if file_path.contains("$-$") {
        let parts: Vec<_> = file_path.split("$-$").collect();
        let old_name = format!("{}/{}", STORAGE_PATH.as_str(), parts[0]);
        let new_name = format!("{}/{}", STORAGE_PATH.as_str(), parts[1]);

        if tokio::fs::metadata(&new_name).await.is_ok() {
            file_path = parts[1].to_string();
        } else if tokio::fs::metadata(&old_name).await.is_ok() {
            file_path = parts[0].to_string();
        } else {
            file_path = parts[1].to_string();
        }
    }

    let file_path = format!("{}/{}", STORAGE_PATH.as_str(), file_path);
    let dir = std::path::Path::new(&file_path).parent().unwrap();

    tokio::fs::create_dir_all(dir).await.unwrap();
    tokio::fs::write(&file_path, body).await.unwrap();
}
