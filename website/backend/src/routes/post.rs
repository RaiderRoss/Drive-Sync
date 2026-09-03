//! # File Management Handlers
//!
//! Provides HTTP handlers for uploading, creating, renaming, and sharing
//! files and directories.
//!
//! These handlers operate on files belonging to the authenticated user and
//! communicate file changes to connected clients through server-sent events.
//!
//! ## Endpoints
//!
//! - `POST /upload` - Upload files to the user's root directory.
//! - `POST /upload/{folder_path}` - Upload files to a specific directory.
//! - `POST /share` - Create a shared link for a file or directory.
//! - `POST /path/{full_path}` - Create a file or directory.
//! - `PUT /rename` - Rename a file or directory.

use std::{
    fs::{self, File},
    io::Write,
    path::PathBuf,
};

use axum::{
    Extension, Json,
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
};

use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    AppState, EventScope, ServerEvent,
    routes::{
        auth::{AuthUser, Data},
        get::get_directory_size,
    },
    util::{
        db::{
            change_shared_file_path, check_shared_file_exists, create_shared_file,
            get_shared_file_by_id,
        },
        util::{MAX_STORAGE_BYTES, get_user_path, log_actions},
    },
};

/// Uploads files to the authenticated user's root storage directory.
///
/// This handler is a convenience wrapper around [`create_file`] that uses
/// the user's root directory as the upload destination.
///
/// # Endpoint
///
/// `POST /upload`
///
/// # Authorization
///
/// Requires a valid authenticated user.
///
/// # Request
///
/// The request must contain a multipart form containing one or more files.
///
/// # Returns
///
/// * `200 OK` - Files were uploaded successfully.
/// * `500 Internal Server Error` - The upload directory could not be prepared
///   or a file could not be saved.
/// * `413 Payload Too Large` - The upload would exceed the configured storage
///   limit.
pub async fn upload_root(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    State(state): State<AppState>,
    multipart: Multipart,
) -> impl IntoResponse {
    create_file(PathBuf::new(), multipart, state, claims).await
}

/// Uploads files to a directory belonging to the authenticated user.
///
/// # Endpoint
///
/// `POST /upload/{folder_path}`
///
/// # Authorization
///
/// Requires a valid authenticated user.
///
/// # Path Parameters
///
/// * `folder_path` - The path of the directory where the uploaded files should be stored.
///
/// # Request
///
/// The request must contain a multipart form containing one or more files.
///
/// # Returns
///
/// * `200 OK` - Files were uploaded successfully.
/// * `500 Internal Server Error` - The upload directory could not be prepared, created, or written to.
/// * `413 Payload Too Large` - The upload would exceed the configured storage limit.
pub async fn upload_file(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    Path(folder_path): Path<String>,
    State(state): State<AppState>,
    multipart: Multipart,
) -> impl IntoResponse {
    create_file(PathBuf::from(folder_path), multipart, state, claims).await
}

/// Creates a shared link for a file or directory.
///
/// The path is associated with the authenticated user and stored in the
/// database. Connected administrators are notified of the newly created
/// shared link through a server-sent event.
///
/// # Endpoint
///
/// `POST /share`
///
/// # Authorization
///
/// Requires a valid authenticated user.
///
/// # Request Body
///
/// The request body must contain a JSON object with a `path` field.
///
/// ```json
/// {
///     "path": "documents/report.pdf"
/// }
/// ```
///
/// # Responses
///
/// * `200 OK` - The shared link was created. The response contains the
///   generated shared-link ID.
/// * `409 Conflict` - A shared link for the specified path already exists.
/// * `500 Internal Server Error` - The existing share could not be checked or
///   the shared link could not be created.
pub async fn create_shared_path(
    State(state): State<AppState>,
    Extension(AuthUser(claims)): Extension<AuthUser>,
    Json(path): Json<Value>,
) -> impl IntoResponse {
    let data = path.get("path").and_then(|p| p.as_str()).unwrap_or("");

    let owner_id = claims.user.clone();

    let exists = check_shared_file_exists(&state.db, &owner_id, data).await;

    match exists {
        Ok(true) => {
            return (
                StatusCode::CONFLICT,
                "Shared link for this path already exists",
            )
                .into_response();
        }
        Ok(false) => {}
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to check existing shared links",
            )
                .into_response();
        }
    }

    let id = create_shared_file(&state.db, &owner_id, data).await;

    match id {
        Ok(id) => {
            let created_at = get_shared_file_by_id(&state.db, &id).await;
            let created_at = created_at.unwrap().2;

            let _ = state.events.send(ServerEvent {
                scope: EventScope::Admin,
                event_type: "share_event".to_string(),
                data: json!({
                    "action": "create",
                    "share_id": id,
                    "file_path": data,
                    "created_by": owner_id,
                    "created_at": created_at,
                })
                .into(),
            });

            if !claims.admin {
                let _ = state.events.send(ServerEvent {
                    scope: EventScope::User(owner_id.clone()),
                    event_type: "share_event".to_string(),
                    data: json!({
                        "action": "create",
                        "share_id": id,
                        "file_path": data,
                        "created_by": owner_id,
                        "created_at": created_at,
                    })
                    .into(),
                });
            }

            log_actions(owner_id, "create_shared_link".into(), data.to_string());

            (StatusCode::OK, Json(Value::String(id))).into_response()
        }
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create shared link",
        )
            .into_response(),
    }
}

/// Creates and stores uploaded files for an authenticated user.
///
/// The upload directory is created if it does not already exist. Multipart
/// fields are processed individually and each file is written to disk in
/// chunks.
///
/// The function enforces [`MAX_STORAGE_BYTES`] and removes a partially
/// uploaded file if the storage limit would be exceeded.
///
/// After a successful upload, a file event is sent to the authenticated
/// user's connected clients.
///
/// # Arguments
///
/// * `relative_path` - The directory or file path relative to the user's
///   upload root.
/// * `multipart` - The multipart request containing the uploaded files.
/// * `state` - Application state containing the database and event channel.
/// * `user` - Authentication data for the current user.
///
/// # Returns
///
/// * `200 OK` - All files were uploaded successfully.
/// * `413 Payload Too Large` - The storage limit would be exceeded.
/// * `500 Internal Server Error` - A directory, file, or storage operation
///   failed.
///
/// # Storage Limit
///
/// Uploaded data is limited by [`MAX_STORAGE_BYTES`].
pub async fn create_file(
    relative_path: PathBuf,
    mut multipart: Multipart,
    state: AppState,
    user: Data,
) -> impl IntoResponse {
    let user_id = user.user.clone();
    let upload_root = get_user_path(user_id.clone());

    if fs::create_dir_all(&upload_root).is_err() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to prepare upload root",
        )
            .into_response();
    }

    let file_path = relative_path;
    let full_path = upload_root.join(&file_path);

    if let Some(parent) = full_path.parent()
        && let Err(_) = fs::create_dir_all(parent)
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create upload directory",
        )
            .into_response();
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

            if file.write_all(&chunk).is_err() {
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to save file").into_response();
            }

            used_bytes += chunk_len;
        }

        // Get the path relative to the user's upload root.
        let relative_final_path = final_path
            .strip_prefix(&upload_root)
            .unwrap_or(&final_path)
            .to_string_lossy()
            .to_string();

        // Get metadata for the actual file.
        let metadata = final_path.metadata().ok();

        // Notify connected clients about the newly created file.
        let _ = state.events.send(ServerEvent {
            scope: EventScope::User(user_id.clone()),
            event_type: "file_event".to_string(),
            data: json!({
                "action": "create",
                "path": relative_final_path,
                "is_dir": false,
                "size": metadata.as_ref().map(|m| m.len()),
                "date_modified": metadata
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.elapsed().ok())
                    .map(|e| e.as_secs()),
                "file_type": final_path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|s| s.to_string()),
            })
            .into(),
        });
    }

    log_actions(
        user_id,
        "upload".into(),
        full_path.to_string_lossy().to_string(),
    );

    (StatusCode::OK, "Files uploaded successfully").into_response()
}

/// Creates a new file or directory for the authenticated user.
///
/// A path ending in `/` is treated as a directory and is created using
/// `create_dir_all`. Other paths are treated as files.
///
/// Paths containing `..` are rejected to prevent traversal outside the user's
/// storage directory.
///
/// # Endpoint
///
/// `POST /path/{full_path}`
///
/// # Authorization
///
/// Requires a valid authenticated user.
///
/// # Path Parameters
///
/// * `full_path` - The path of the file or directory to create. A trailing
///   `/` indicates that the path represents a directory.
///
/// # Responses
///
/// * `200 OK` - The file or directory was created successfully.
/// * `400 Bad Request` - The path is empty or contains `..`.
/// * `500 Internal Server Error` - The file or directory could not be created.
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
    let upload_root = get_user_path(claims.user);

    let mut path_buf = upload_root;
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

/// Request payload used to rename a file or directory.
#[derive(Deserialize)]
pub struct RenamePayload {
    /// The existing path of the file or directory.
    pub old_path: String,

    /// The new path of the file or directory.
    pub new_path: String,
}

/// Renames a file or directory belonging to the authenticated user.
///
/// The operation also updates any shared-file records associated with the
/// renamed path, including files contained within a renamed directory.
///
/// # Endpoint
///
/// `PUT /rename`
///
/// # Authorization
///
/// Requires a valid authenticated user.
///
/// # Request Body
///
/// The request must contain a JSON object with `old_path` and `new_path`
/// fields.
///
/// ```json
/// {
///     "old_path": "documents/old_name.txt",
///     "new_path": "documents/new_name.txt"
/// }
/// ```
///
/// # Responses
///
/// * `200 OK` - The path was renamed successfully.
/// * `400 Bad Request` - Either path is empty, contains `..`, or is an
///   absolute path.
/// * `404 Not Found` - The source path does not exist.
/// * `500 Internal Server Error` - The destination could not be prepared or
///   the rename operation failed.
///
/// # Side Effects
///
/// Successful renames are recorded in the application action log.
pub async fn rename_path(
    State(state): State<AppState>,
    Extension(AuthUser(claims)): Extension<AuthUser>,
    Json(payload): Json<RenamePayload>,
) -> impl IntoResponse {
    let user_id = claims.user.clone();
    let upload_root = get_user_path(claims.user);

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

    let db = &state.db;

    if change_shared_file_path(db, &user_id, &payload.old_path, &payload.new_path)
        .await
        .is_err()
    {
        eprintln!(
            "rename_path: failed to update shared_files for {} -> {}",
            payload.old_path, payload.new_path
        );
    }

    let mut old_full = PathBuf::from(&upload_root);
    old_full.push(payload.old_path.trim_start_matches(['/', '\\']));

    let mut new_full = PathBuf::from(&upload_root);
    new_full.push(payload.new_path.trim_start_matches(['/', '\\']));

    if !old_full.exists() {
        return (StatusCode::NOT_FOUND, "Source path does not exist").into_response();
    }

    if let Some(parent) = new_full.parent()
        && let Err(_) = fs::create_dir_all(parent)
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to prepare destination",
        )
            .into_response();
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
