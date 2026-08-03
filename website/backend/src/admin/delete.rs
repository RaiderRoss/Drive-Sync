use std::fs::remove_dir_all;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};

use crate::{AppState, admin::db::delete_user, util::get_user_path};

pub async fn remove_user(
    Path(user_id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let db = &state.db;
    let user_path = get_user_path(user_id.clone());

    if std::path::Path::new(&user_path).exists()
        && let Err(e) = remove_dir_all(&user_path) {
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
