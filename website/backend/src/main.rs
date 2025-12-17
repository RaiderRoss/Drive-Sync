use axum::{
    Router,
    extract::{Multipart, Path},
    http::{Method, StatusCode},
    response::IntoResponse,
    Json,
    routing::{delete, get, post},
};
use serde::Deserialize;
use std::sync::OnceLock;
use std::{
    fs::{self, File},
    io::Write,
    path::PathBuf,
};
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

pub mod delete;
pub mod get;
pub mod util;

use delete::delete_file;
use get::{
    download_file, get_directory_size, list_uploaded_files, list_uploaded_files_root, stream_video,
};

static UPLOAD_DIR: OnceLock<String> = OnceLock::new();
const MAX_STORAGE_BYTES: u64 = 100 * 1024 * 1024 * 1024;

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    UPLOAD_DIR
        .set(std::env::var("STORAGE_ROOT").unwrap())
        .expect("Failed to set UPLOAD_DIR");

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any);

    let app = Router::new()
        .route("/upload/{*path}", post(upload_file))
        .route("/upload/", post(upload_root))
        .route("/uploads/{*path}", get(list_uploaded_files))
        .route("/uploads", get(list_uploaded_files_root))
        .route("/download/{*path}", get(download_file))
        .route("/stream/{*path}", get(stream_video))
        .route("/download/{*path}", delete(delete_file))
        .route("/create_path/{*path}", post(create_path))
        .route("/delete/{*path}", delete(delete_file))
        .route("/rename", post(rename_path))
        .layer(cors)
        .layer(axum::extract::DefaultBodyLimit::disable());

    let listener = TcpListener::bind("0.0.0.0:4023").await.unwrap();

    axum::serve(listener, app).await.unwrap();
}

async fn upload_root(multipart: Multipart) -> impl IntoResponse {
    create_file(PathBuf::new(), multipart).await
}

async fn upload_file(Path(folder_path): Path<String>, multipart: Multipart) -> impl IntoResponse {
    create_file(PathBuf::from(folder_path), multipart).await
}

async fn create_file(relative_path: PathBuf, mut multipart: Multipart) -> impl IntoResponse {
    let upload_root = PathBuf::from(UPLOAD_DIR.get().expect("UPLOAD_DIR not set"));
    let file_path = PathBuf::from(relative_path);
    let full_path = upload_root.join(&file_path);

    if let Some(parent) = full_path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            eprintln!("Failed to create directory {}: {}", parent.display(), e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create upload directory",
            )
                .into_response();
        }
    }

    let mut used_bytes = match get_directory_size(upload_root.clone()) {
        Ok(size) => size,
        Err(e) => {
            eprintln!("Failed to get directory size: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to check storage usage",
            )
                .into_response();
        }
    };

    while let Some(mut field) = multipart.next_field().await.unwrap_or(None) {
        let file_name = field
            .file_name()
            .map(|n| n.to_string())
            .unwrap_or_else(|| format!("upload-{}.bin", Uuid::new_v4()));

        let mut final_path = full_path.clone();
        if full_path.is_dir() {
            final_path.push(&file_name);
        }

        let mut file = match File::create(&final_path) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("Failed to create file {}: {}", final_path.display(), e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create file")
                    .into_response();
            }
        };

        while let Some(chunk) = field.chunk().await.unwrap_or(None) {
            let chunk_len = chunk.len() as u64;

            if used_bytes + chunk_len > MAX_STORAGE_BYTES {
                let _ = fs::remove_file(&final_path);
                return (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    format!(
                        "Upload would exceed storage limit ({} GB used)",
                        used_bytes / 1_073_741_824
                    ),
                )
                    .into_response();
            }

            if let Err(e) = file.write_all(&chunk) {
                eprintln!("Failed to write file {}: {}", final_path.display(), e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save file").into_response();
            }

            used_bytes += chunk_len;
        }
    }

    (StatusCode::OK, "Files uploaded successfully").into_response()
}

async fn create_path(Path(full_path): Path<String>) -> impl IntoResponse {

    if full_path.contains("..") {
        return (StatusCode::BAD_REQUEST, "Invalid path with '..' not allowed").into_response();
    }

    if full_path.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "Path cannot be empty").into_response();
    }

    let upload_root = UPLOAD_DIR.get().expect("UPLOAD_DIR not set");
    let mut path_buf = PathBuf::from(upload_root);
    path_buf.push(full_path.trim_start_matches('/'));

    if full_path.ends_with('/') {
        match fs::create_dir_all(&path_buf) {
            Ok(_) => (StatusCode::OK, "Folder created successfully").into_response(),
            Err(e) => {
                eprintln!("Failed to create folder {}: {}", path_buf.display(), e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create folder").into_response()
            }
        }
    } else {
        match fs::File::create(&path_buf) {
            Ok(_) => (StatusCode::OK, "File created successfully").into_response(),
            Err(e) => {
                eprintln!("Failed to create file {}: {}", path_buf.display(), e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create file").into_response()
            }
        }
    }
}

#[derive(Deserialize)]
struct RenamePayload {
    old_path: String,
    new_path: String,
}

async fn rename_path(Json(payload): Json<RenamePayload>) -> impl IntoResponse {
    let upload_root = UPLOAD_DIR.get().expect("UPLOAD_DIR not set");

    if payload.old_path.trim().is_empty() || payload.new_path.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "Both old_path and new_path are required").into_response();
    }

    if payload.old_path.contains("..") || payload.new_path.contains("..") {
        return (StatusCode::BAD_REQUEST, "Invalid path with '..' not allowed").into_response();
    }

    if std::path::Path::new(&payload.old_path).is_absolute()
        || std::path::Path::new(&payload.new_path).is_absolute()
    {
        return (StatusCode::BAD_REQUEST, "Absolute paths are not allowed").into_response();
    }

    let mut old_full = PathBuf::from(upload_root);
    old_full.push(payload.old_path.trim_start_matches(|c| c == '/' || c == '\\'));

    let mut new_full = PathBuf::from(upload_root);
    new_full.push(payload.new_path.trim_start_matches(|c| c == '/' || c == '\\'));

    if !old_full.exists() {
        return (StatusCode::NOT_FOUND, "Source path does not exist").into_response();
    }

    if let Some(parent) = new_full.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            eprintln!("Failed to create destination parent {}: {}", parent.display(), e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to prepare destination").into_response();
        }
    }

    match fs::rename(&old_full, &new_full) {
        Ok(_) => (StatusCode::OK, "Path renamed successfully").into_response(),
        Err(e) => {
            eprintln!(
                "Failed to rename {} -> {}: {}",
                old_full.display(),
                new_full.display(),
                e
            );
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to rename path").into_response()
        }
    }
}