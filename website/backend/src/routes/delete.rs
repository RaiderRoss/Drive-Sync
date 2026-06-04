use axum::{Extension, extract::Path, http::StatusCode, response::IntoResponse};
use std::{fs, path::PathBuf};

use crate::{auth::AuthUser, util::get_user_path};

pub async fn delete_file(Extension(AuthUser(claims)): Extension<AuthUser>, Path(target_path): Path<String>) -> impl IntoResponse {
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
        Ok(_) => (StatusCode::OK, "Deleted successfully").into_response(),
        Err(e) => {
            eprintln!("Failed to delete file or folder{}{}", target_path, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete file or folder",
            )
                .into_response()
        }
    }
}
