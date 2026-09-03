//! # File Deletion Handlers
//!
//! This module provides handlers for deleting files, directories, and shared
//! file links.
//!
//! Deleted files generate user-scoped file events, while deleted share links
//! generate administrator-scoped share events.

use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};

use serde_json::json;

use std::fs;

use crate::{
    AppState,
    EventScope::{Admin, User},
    routes::auth::AuthUser,
    util::{
        db::delete_shared_file,
        util::{get_user_path, log_actions},
    },
};

/// Deletes a file or directory belonging to the authenticated user.
///
/// The target path is resolved relative to the authenticated user's storage
/// directory. If the target is a regular file, it is removed using
/// [`fs::remove_file`]. If the target is a directory, the directory and all of
/// its contents are removed using [`fs::remove_dir_all`].
///
/// After a successful deletion, a user-scoped `file_event` is broadcast so
/// that other active sessions belonging to the same user can update their
/// file listings.
///
/// The deletion is also recorded using [`log_actions`].
///
/// # Arguments
///
/// * `Extension(AuthUser(claims))` - Authentication information containing the
///   authenticated user's ID.
/// * `State(state)` - Application state containing the event broadcaster.
/// * `Path(target_path)` - The file or directory path to delete, relative to
///   the user's storage directory.
///
/// # Returns
///
/// Returns `200 OK` with `"Deleted successfully"` when the file or directory
/// is successfully deleted.
///
/// # Errors
///
/// Returns `404 Not Found` when the target file or directory does not exist.
///
/// Returns `400 Bad Request` when the target exists but is neither a regular
/// file nor a directory.
///
/// Returns `500 Internal Server Error` when the filesystem operation fails.
pub async fn delete_file(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    State(state): State<AppState>,
    Path(target_path): Path<String>,
) -> impl IntoResponse {

    let user_id = claims.user.clone();

    let mut path = get_user_path(claims.user);

    path.push(&target_path);

    if !path.exists() {
        return (StatusCode::NOT_FOUND, "File or folder not found").into_response();
    }

    let result = if path.is_file() {
        fs::remove_file(&path)
    } else if path.is_dir() {
        fs::remove_dir_all(&path)
    } else {
        return (StatusCode::BAD_REQUEST, "Invalid file or folder").into_response();
    };

    match result {
        Ok(_) => {
            log_actions(user_id.clone(), "delete".to_string(), target_path.clone());

            let _ = state.events.send(crate::ServerEvent {
                scope: User(user_id),
                event_type: "file_event".to_string(),
                data: json!({
                    "action": "delete",
                    "path": target_path,
                }).into(),
            });

            (StatusCode::OK, "Deleted successfully").into_response()
        }

        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete file or folder",
        )
            .into_response(),
    }
}

/// Deletes a shared-file link.
///
/// The share link is identified by its unique database ID. After the
/// corresponding database record is deleted, an administrator-scoped
/// `share_event` is broadcast to notify connected administrators of the
/// deletion.
///
/// # Arguments
///
/// * `Path(id)` - The unique identifier of the shared-file link.
/// * `State(state)` - Application state containing the database connection and
///   event broadcaster.
///
/// # Returns
///
/// Returns `200 OK` with `"Share link deleted successfully"` when the share
/// link is successfully deleted.
///
/// # Errors
///
/// Returns `500 Internal Server Error` when the shared-file database record
/// cannot be deleted.
pub async fn delete_share_link(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {

    let db = &state.db;

    let res = delete_shared_file(db, &id).await;

    match res {
        Ok(_) => {
            let _ = state.events.send(crate::ServerEvent {
                scope: Admin,
                event_type: "share_event".to_string(),
                data: json!({
                    "action": "delete",
                    "share_id": id,
                }).into(),
            });

            (StatusCode::OK, "Share link deleted successfully").into_response()
        }

        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete share link",
        )
            .into_response(),
    }
}
