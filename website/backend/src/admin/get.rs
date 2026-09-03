//! # User and Share Listing Handlers
//!
//! This module provides handlers for retrieving shared files across users
//! and listing registered users.
//!
//! The handlers return their results as JSON responses and are intended for
//! use by routes that have appropriate authorization applied by the router.

use axum::{Json, extract::State, http::StatusCode};

use serde::Serialize;

use crate::{
    AppState,
    util::db::{get_all_users, get_shares},
};

/// Represents a shared file returned when listing shares belonging to users.
///
/// This structure contains the username of the owner, the unique share
/// identifier, the path of the shared file, and the time at which the share
/// was created.
#[derive(Serialize)]
pub struct ShareEntryResponse {
    /// Username of the user who owns the shared file.
    user_name: String,

    /// Unique identifier of the shared file.
    id: String,

    /// Path of the shared file relative to the owner's storage directory.
    file_path: String,

    /// Unix timestamp representing when the share was created.
    created_at: i64,
}

/// Lists all shared files belonging to users.
///
/// The shared-file records are retrieved from the database without applying
/// an owner filter. Each database record is converted into a
/// [`ShareEntryResponse`] before being returned as JSON.
///
/// # Arguments
///
/// * `State(state)` - Application state containing the database connection.
///
/// # Returns
///
/// Returns `200 OK` with a JSON array containing information about every
/// shared file.
///
/// Example response:
///
/// ```json
/// [
///     {
///         "user_name": "alice",
///         "id": "8d3c...",
///         "file_path": "/documents/report.pdf",
///         "created_at": 1720000000
///     }
/// ]
/// ```
///
/// # Errors
///
/// Returns [`StatusCode::INTERNAL_SERVER_ERROR`] when the database query
/// fails.
pub async fn list_users_shares(
    State(state): State<AppState>,
) -> Result<Json<Vec<ShareEntryResponse>>, StatusCode> {

    let shares = get_shares(&state.db, None).await.map_err(|e| {
        eprintln!("list_shared_files: db error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(
        shares
            .into_iter()
            .map(|s| ShareEntryResponse {
                user_name: s.0,
                id: s.1,
                file_path: s.2,
                created_at: s.3,
            })
            .collect(),
    ))
}

/// Represents a user returned by the user-listing endpoint.
///
/// The response contains the user's unique identifier and username.
#[derive(Serialize)]
pub struct UserResponse {
    /// Unique identifier of the user.
    id: String,

    /// Username of the user.
    username: String,
}

/// Retrieves all registered users.
///
/// User records are obtained from the database and converted into
/// [`UserResponse`] values before being returned as a JSON array.
///
/// # Arguments
///
/// * `State(state)` - Application state containing the database connection.
///
/// # Returns
///
/// Returns `200 OK` with a JSON array containing the ID and username of
/// every registered user.
///
/// Example response:
///
/// ```json
/// [
///     {
///         "id": "8d3c...",
///         "username": "alice"
///     },
///     {
///         "id": "91af...",
///         "username": "bob"
///     }
/// ]
/// ```
///
/// # Errors
///
/// Returns [`StatusCode::INTERNAL_SERVER_ERROR`] when the database query
/// fails.
pub async fn get_users(
    State(state): State<AppState>,
) -> Result<Json<Vec<UserResponse>>, StatusCode> {

    let users = get_all_users(&state.db).await.map_err(|e| {
        eprintln!("get_users: db error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(
        users
            .into_iter()
            .map(|(id, username)| UserResponse { id, username })
            .collect(),
    ))
}
