use axum::{Json, extract::State, http::StatusCode};
use serde::Serialize;

use crate::{AppState, admin::db::{get_all_users, get_shares}};

#[derive(Serialize)]
pub struct ShareEntryResponse {
    user_name: String,
    id: String,
    file_path: String,
    created_at: i64,
}

pub async fn list_users_shares(
    State(state): State<AppState>,
) -> Result<Json<Vec<ShareEntryResponse>>, StatusCode> {
    let shares = get_shares(&state.db).await.map_err(|e| {
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

#[derive(Serialize)]
pub struct UserResponse {
    id: String,
    username: String,
}

pub async fn get_users(
    State(state): State<AppState>,
) -> Result<Json<Vec<UserResponse>>, StatusCode> {
    let users = get_all_users(&state.db).await.map_err(|e| {
        eprintln!("get_users: db error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(users.into_iter().map(|(id, username)| UserResponse { id, username }).collect()))
}