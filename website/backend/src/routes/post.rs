use std::{
    fs::{self, File},
    io::Write,
    path::PathBuf,
};

use axum::{
    Extension, Json,
    extract::{Multipart, Path},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    auth::{AuthUser, Data},
    routes::get::get_directory_size,
    util::{MAX_STORAGE_BYTES, get_user_path, log_actions},
};

pub async fn upload_root(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    multipart: Multipart,
) -> impl IntoResponse {
    create_file(PathBuf::new(), multipart, claims).await
}

pub async fn upload_file(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    Path(folder_path): Path<String>,
    multipart: Multipart,
) -> impl IntoResponse {
    create_file(PathBuf::from(folder_path), multipart, claims).await
}

pub async fn create_file(
    relative_path: PathBuf,
    mut multipart: Multipart,
    user: Data,
) -> impl IntoResponse {
    let user_id = user.user.clone();
    let upload_root = PathBuf::from(get_user_path(user_id.clone(), user.admin));
    if let Err(_) = fs::create_dir_all(&upload_root) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to prepare upload root",
        )
            .into_response();
    }

    let file_path = PathBuf::from(relative_path);
    let full_path = upload_root.join(&file_path);

    if let Some(parent) = full_path.parent() {
        if let Err(_) = fs::create_dir_all(parent) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create upload directory",
            )
                .into_response();
        }
    }

    let mut used_bytes = match get_directory_size(upload_root.clone()) {
        Ok(size) => size,
        Err(_) => {
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
        if file_path.as_os_str().is_empty() || full_path.is_dir() {
            final_path.push(&file_name);
        }

        let mut file = match File::create(&final_path) {
            Ok(f) => f,
            Err(_) => {
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

            if let Err(_) = file.write_all(&chunk) {
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save file").into_response();
            }

            used_bytes += chunk_len;
        }
    }

    log_actions(
        user_id,
        "upload".into(),
        full_path.to_string_lossy().to_string(),
    );
    (StatusCode::OK, "Files uploaded successfully").into_response()
}

pub async fn create_path(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    Path(full_path): Path<String>,
) -> impl IntoResponse {
    if full_path.contains("..") {
        return (
            StatusCode::BAD_REQUEST,
            "Invalid path with '..' not allowed",
        )
            .into_response();
    }

    if full_path.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "Path cannot be empty").into_response();
    }

    let user_id = claims.user.clone();

    let upload_root = get_user_path(claims.user, claims.admin);
    let mut path_buf = PathBuf::from(upload_root);
    path_buf.push(full_path.trim_start_matches('/'));

    if full_path.ends_with('/') {
        match fs::create_dir_all(&path_buf) {
            Ok(_) => (StatusCode::OK, "Folder created successfully").into_response(),
            Err(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create folder").into_response()
            }
        }
    } else {
        match fs::File::create(&path_buf) {
            Ok(_) => {
                log_actions(
                    user_id,
                    "create_file".into(),
                    path_buf.to_string_lossy().to_string(),
                );
                (StatusCode::OK, "File created successfully").into_response()
            }
            Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create file").into_response(),
        }
    }
}

#[derive(Deserialize)]
pub struct RenamePayload {
    old_path: String,
    new_path: String,
}

pub async fn rename_path(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    Json(payload): Json<RenamePayload>,
) -> impl IntoResponse {
    let user_id = claims.user.clone();

    let upload_root = get_user_path(claims.user, claims.admin);

    if payload.old_path.trim().is_empty() || payload.new_path.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            "Both old_path and new_path are required",
        )
            .into_response();
    }

    if payload.old_path.contains("..") || payload.new_path.contains("..") {
        return (
            StatusCode::BAD_REQUEST,
            "Invalid path with '..' not allowed",
        )
            .into_response();
    }

    if std::path::Path::new(&payload.old_path).is_absolute()
        || std::path::Path::new(&payload.new_path).is_absolute()
    {
        return (StatusCode::BAD_REQUEST, "Absolute paths are not allowed").into_response();
    }

    let mut old_full = PathBuf::from(&upload_root);
    old_full.push(
        payload
            .old_path
            .trim_start_matches(|c| c == '/' || c == '\\'),
    );

    let mut new_full = PathBuf::from(&upload_root);
    new_full.push(
        payload
            .new_path
            .trim_start_matches(|c| c == '/' || c == '\\'),
    );

    if !old_full.exists() {
        return (StatusCode::NOT_FOUND, "Source path does not exist").into_response();
    }

    if let Some(parent) = new_full.parent() {
        if let Err(_) = fs::create_dir_all(parent) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to prepare destination",
            )
                .into_response();
        }
    }

    match fs::rename(&old_full, &new_full) {
        Ok(_) => {
            log_actions(
                user_id,
                "rename".into(),
                format!(
                    "{} -> {}",
                    old_full.to_string_lossy(),
                    new_full.to_string_lossy()
                ),
            );
            (StatusCode::OK, "Path renamed successfully").into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Failed to rename path").into_response(),
    }
}
