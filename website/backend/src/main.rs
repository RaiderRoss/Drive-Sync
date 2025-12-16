use axum::{
    Router,
    extract::{Multipart, Path},
    http::{Method, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
};
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
    download_file, get_directory_size, list_uploaded_files, list_uploaded_files_root,
    stream_video,
};

static UPLOAD_DIR: OnceLock<String> = OnceLock::new();
const MAX_STORAGE_BYTES: u64 = 100 * 1024 * 1024 * 1024;

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    UPLOAD_DIR
        .set(std::env::var("STORAGE_ROOT").expect("Storage root is not defined in ENV file"))
        .expect("Failed to set UPLOAD_DIR");

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any);

    let app = Router::new()
        .route("/upload/{*folder_path}", post(upload_file))
        .route("/uploads/{*dir_path}", get(list_uploaded_files))
        .route("/uploads", get(list_uploaded_files_root))
        .route("/download/{*path}", get(download_file))
        .route("/stream/{*path}", get(stream_video))
        .route("/download/{*path}", delete(delete_file))
        .route("/create_folder/{*folder_path}", post(create_folder))
        .layer(cors)
        .layer(axum::extract::DefaultBodyLimit::disable());

    let listener = TcpListener::bind("0.0.0.0:4023").await.unwrap();
    println!(
        "Server running at http://{}",
        listener.local_addr().unwrap()
    );

    axum::serve(listener, app).await.unwrap();
}

async fn upload_file(
    Path(folder_path): Path<String>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let upload_root = UPLOAD_DIR.get().expect("UPLOAD_DIR not set");
    let mut upload_path = PathBuf::from(upload_root);

    if !folder_path.is_empty() {
        if folder_path.contains("..") {
            return (
                StatusCode::BAD_REQUEST,
                "Invalid folder path with '..' not allowed",
            )
                .into_response();
        }

        upload_path.push(&folder_path);
    }

    if let Err(e) = fs::create_dir_all(&upload_path) {
        eprintln!(
            "Failed to create directory {}: {}",
            upload_path.display(),
            e
        );
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create upload directory",
        )
            .into_response();
    }

    let current_usage = match get_directory_size(upload_root) {
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

    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let file_name = field
            .file_name()
            .map(|name| name.to_string())
            .unwrap_or_else(|| format!("upload-{}.bin", Uuid::new_v4()));

        let data = field.bytes().await.unwrap_or_default();
        let new_file_size = data.len() as u64;

        if current_usage + new_file_size > MAX_STORAGE_BYTES {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                format!(
                    "Upload would exceed storage limit ({} GB used)",
                    current_usage / 1_073_741_824
                ),
            )
                .into_response();
        }

        let mut file_path = upload_path.clone();
        file_path.push(file_name);

        match File::create(&file_path) {
            Ok(mut file) => {
                if let Err(e) = file.write_all(&data) {
                    eprintln!("Failed to write file: {}", e);
                    return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save file")
                        .into_response();
                }
            }
            Err(e) => {
                eprintln!("Failed to create file: {}", e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create file")
                    .into_response();
            }
        }

        println!("Saved file: {}", file_path.display());
    }

    (StatusCode::OK, "Files uploaded successfully").into_response()
}

async fn create_folder(Path(full_path): Path<String>) -> impl IntoResponse {
    if full_path.contains("..") {
        return (
            StatusCode::BAD_REQUEST,
            "Invalid path with '..' not allowed",
        )
            .into_response();
    }

    if full_path.trim().is_empty() || full_path.ends_with('/') {
        return (
            StatusCode::BAD_REQUEST,
            "Folder name must be specified and cannot end with '/'",
        )
            .into_response();
    }

    let upload_root = UPLOAD_DIR.get().expect("UPLOAD_DIR not set");
    let mut dir_path = PathBuf::from(upload_root);
    dir_path.push(full_path.trim_start_matches('/'));

    match fs::create_dir_all(&dir_path) {
        Ok(_) => (StatusCode::OK, "Folder created successfully").into_response(),
        Err(e) => {
            eprintln!("Failed to create folder {}: {}", dir_path.display(), e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create folder").into_response()
        }
    }
}
