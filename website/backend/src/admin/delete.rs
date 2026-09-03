//! # User Deletion Handler
//!
//! This module provides functionality for permanently deleting a user and
//! the files associated with that user.

use std::fs::remove_dir_all;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};

use crate::{
    AppState,
    util::{db::delete_user, util::get_user_path},
};

/// Deletes a user and all files stored in the user's directory.
///
/// The user's storage directory is removed from the filesystem first. If
/// the directory does not exist, the deletion continues with the database
/// record. Once the filesystem operation succeeds, the user is removed from
/// the database.
///
/// # Arguments
///
/// * `Path(user_id)` - The unique identifier of the user to delete.
/// * `State(state)` - Application state containing the database connection.
///
/// # Returns
///
/// Returns `200 OK` when the user is successfully deleted.
///
/// Returns `500 Internal Server Error` if the user's files cannot be removed
/// or if the user cannot be deleted from the database.
///
/// # Side Effects
///
/// This operation permanently removes the user's entire storage directory
/// and deletes the corresponding user record from the database.
pub async fn remove_user(
    Path(user_id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {

    let db = &state.db;

    let user_path = get_user_path(user_id.clone());

    if std::path::Path::new(&user_path).exists()
        && let Err(e) = remove_dir_all(&user_path)
    {
        eprintln!("Failed to delete user files: {}", e);

        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete user files",
        )
            .into_response();
    }

    match delete_user(&user_id, db).await {
        Ok(_) => (StatusCode::OK, "User deleted successfully").into_response(),
        
        Err(e) => {
            eprintln!("Failed to delete user from database: {}", e);

            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete user from database",
            )
                .into_response()
        }
    }

}
