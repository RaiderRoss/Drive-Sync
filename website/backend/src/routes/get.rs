use crate::AppState;
use crate::auth::AuthUser;
use crate::db::get_shared_file_by_id;
use crate::util::{clean_path, get_user_path};
use axum::Extension;
use axum::extract::State;
use axum::{
    Json,
    body::Body,
    extract::Path,
    http::{HeaderMap, HeaderValue, Response, StatusCode, header},
    response::IntoResponse,
};
use bytes::Bytes;
use futures::StreamExt;
use rayon::prelude::*;
use serde::Serialize;
use std::{collections::HashMap, fs, io, path::PathBuf, time::UNIX_EPOCH};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt},
};
use tokio_util::{bytes, io::ReaderStream};

#[derive(Serialize)]
pub struct FileEntry {
    name: String,
    size: u64,
    is_dir: bool,
    date_modified: u64,
    file_type: String,
}

pub async fn list_uploaded_files(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    path: Option<Path<String>>,
) -> Result<Json<Vec<FileEntry>>, StatusCode> {
    let target_dir = match path {
        Some(Path(p)) => clean_path(p, claims.user, claims.admin).ok_or(StatusCode::NOT_FOUND)?,
        None => PathBuf::from(get_user_path(claims.user, claims.admin)),
    };

    if !target_dir.exists() || !target_dir.is_dir() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut entries = vec![];

    let mut dir_entries = tokio::fs::read_dir(&target_dir)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    while let Some(entry) = dir_entries
        .next_entry()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        let metadata = entry
            .metadata()
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            size: metadata.is_file().then(|| metadata.len()).unwrap_or(0),
            date_modified: metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0),
            file_type: if metadata.is_file() {
                entry
                    .path()
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .unwrap_or("")
                    .to_lowercase()
            } else {
                "folder".to_string()
            },
            is_dir: metadata.is_dir(),
        });
    }

    Ok(Json(entries))
}

pub async fn get_shared_file(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    let db = &state.db;
    let filename = get_shared_file_by_id(db, &id).await;

    if let Err(e) = filename {
        if let sqlx::Error::RowNotFound = e {
            return Ok((StatusCode::NOT_FOUND, "Share link is invalid").into_response());
        }
        return Ok((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to retrieve shared file",
        )
            .into_response());
    }

    let (owner_id, file_path) = filename.unwrap();

    let path = PathBuf::from(get_user_path(owner_id, false)).join(&file_path);

    if !path.exists() || !path.is_file() {
        return Ok((StatusCode::NOT_FOUND, "File not found").into_response());
    }

    let ext = file_path.rsplit('.').next().unwrap_or("").to_lowercase();

    if matches!(ext.as_str(), "mp4" | "webm" | "mkv" | "avi") {
        return serve_video(path, headers, &ext).await.map(|r| r.into_response());
    }

    serve_file(path, file_path).await.map(|r| r.into_response())
}

pub async fn download_file(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    Path(filename): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let mut path = PathBuf::from(get_user_path(claims.user, claims.admin));

    path.push(&filename);

    if !path.exists() || !path.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }

    serve_file(path, filename).await
}

fn mime_type_for_ext(ext: &str) -> &'static str {
    match ext {
        "pdf" => "application/pdf",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "ts" | "tsx" | "jsx" => "text/plain; charset=utf-8",
        "json" => "application/json",
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "md" | "markdown" => "text/markdown; charset=utf-8",
        "txt" | "py" | "rb" | "java" | "cpp" | "c" | "sh" | "rs" | "go" | "php" => {
            "text/plain; charset=utf-8"
        }
        _ => "application/octet-stream",
    }
}

pub async fn serve_file(path: PathBuf, filename: String) -> Result<Response<Body>, StatusCode> {
    match File::open(&path).await {
        Ok(file) => {
            let stream = ReaderStream::new(file);
            let body = Body::from_stream(stream);
            let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
            let content_type = mime_type_for_ext(&ext);

            let mut headers = HeaderMap::new();

            if matches!(content_type, "application/pdf")
                || content_type.starts_with("image/")
                || content_type.starts_with("video/")
                || content_type.starts_with("audio/")
            {
                headers.insert(
                    "Content-Disposition",
                    HeaderValue::from_str(&format!("inline; filename=\"{}\"", filename)).unwrap(),
                );
            } else {
                headers.insert(
                    "Content-Disposition",
                    HeaderValue::from_str(&format!("attachment; filename=\"{}\"", filename))
                        .unwrap(),
                );
            }

            headers.insert(
                "Content-Type",
                HeaderValue::from_str(content_type).unwrap(),
            );

            let response = (headers, body).into_response();
            Ok(response)
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

pub async fn stream_video(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    Path(filename): Path<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    let mut path = PathBuf::from(get_user_path(claims.user, claims.admin));
    path.push(&filename);

    if !path.exists() || !path.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }

    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    serve_video(path, headers, &ext).await
}

pub async fn serve_video(
    path: PathBuf,
    headers: HeaderMap,
    ext: &str,
) -> Result<Response<Body>, StatusCode> {
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let file_size = metadata.len();

    let content_type = match ext {
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        _ => "video/mp4",
    };

    let range_header = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .filter(|s| s.starts_with("bytes="));

    let range_header = match range_header {
        Some(r) => r,
        None => {
            let file = File::open(&path)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let stream = ReaderStream::new(file);
            let response = Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, file_size.to_string())
                .body(axum::body::Body::from_stream(stream))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            return Ok(response);
        }
    };

    let parts: Vec<&str> = range_header[6..].split('-').collect();
    let start: u64 = parts.get(0).and_then(|v| v.parse().ok()).unwrap_or(0);
    let end: u64 = parts
        .get(1)
        .and_then(|v| v.parse().ok())
        .unwrap_or(file_size - 1)
        .min(file_size - 1);

    if start > end || start >= file_size {
        return Err(StatusCode::RANGE_NOT_SATISFIABLE);
    }

    let chunk_size = end - start + 1;

    let mut file = File::open(&path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let stream = ReaderStream::with_capacity(file.take(chunk_size), 16 * 1024).map(|r| {
        r.map(Bytes::from)
            .map_err(|_| std::io::Error::from(std::io::ErrorKind::Other))
    });

    let content_range = format!("bytes {}-{}/{}", start, end, file_size);

    let response = Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_RANGE, content_range)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, chunk_size.to_string())
        .body(axum::body::Body::from_stream(stream))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(response)
}

#[derive(Serialize)]
pub struct StatsResponse {
    storage_used_gb: f64,
    storage_total_gb: u64,
    files_uploaded: u64,
    shared_files: u64,
    folders: u64,
    active_devices: u64,
    subscription_plan: String,
    account_created: String,
    monthly_uploads: u64,
    monthly_downloads: u64,
    notifications: u64,
    files_by_type: HashMap<String, u64>,
}

pub fn get_directory_size<P: AsRef<std::path::Path>>(path: P) -> io::Result<u64> {
    let path = path.as_ref();

    let entries = match fs::read_dir(path) {
        Ok(e) => e.collect::<Result<Vec<_>, _>>()?,
        Err(_) => return Ok(0),
    };

    let size: u64 = entries
        .into_par_iter()
        .map(|entry| {
            let path = entry.path();
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => return 0,
            };

            if meta.is_file() {
                meta.len()
            } else if meta.is_dir() {
                #[cfg(windows)]
                {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.eq_ignore_ascii_case("$RECYCLE.BIN")
                            || name.eq_ignore_ascii_case("System Volume Information")
                        {
                            return 0;
                        }
                    }
                }
                get_directory_size(path).unwrap_or(0)
            } else {
                0
            }
        })
        .sum();

    Ok(size)
}