use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde_json::json;
use std::fs;

use crate::{
    AppState, EventScope::{Admin, User}, routes::auth::AuthUser, util::{
        db::delete_shared_file,
        util::{get_user_path, log_actions},
    },
};

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
