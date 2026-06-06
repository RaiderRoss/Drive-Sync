use axum::{Extension, extract::Path, http::StatusCode, response::IntoResponse};
use std::{fs, path::PathBuf};

use crate::{
    auth::AuthUser,
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
