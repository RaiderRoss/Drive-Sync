use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use std::{fs, path::PathBuf};

use crate::{
    AppState,
    auth::AuthUser,
    db::delete_shared_file,
    util::{get_user_path, log_actions},
};

pub async fn delete_file(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    Path(target_path): Path<String>,
) -> impl IntoResponse {
    let user_id = claims.user.clone();
    let mut path = PathBuf::from(get_user_path(claims.user, claims.admin));
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
            log_actions(user_id, "delete".to_string(), target_path);
            (StatusCode::OK, "Deleted successfully").into_response()
        }
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete file or folder",
        )
            .into_response(),
    }
}

pub async fn delete_share_link(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    println!("Deleting share link with ID: {}", id);
    let db = &state.db;

    let res = delete_shared_file(db, &id).await;

    match res {
        Ok(_) => (StatusCode::OK, "Share link deleted successfully").into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete share link",
        )
            .into_response(),
    }
}
