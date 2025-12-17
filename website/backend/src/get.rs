use axum::{
    Json,
    body::Body,
    extract::Path,
    http::{HeaderMap, HeaderValue, Response, StatusCode, header},
    response::IntoResponse,
};
use bytes::Bytes;
use futures::StreamExt;
use serde::Serialize;
use std::{collections::HashMap, fs, io, path::PathBuf};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt},
};
use tokio_util::{bytes, io::ReaderStream};
use rayon::prelude::*;
use crate::UPLOAD_DIR;
use crate::util::clean_path;

#[derive(Serialize)]
pub struct FileEntry {
    name: String,
    size: u64,
    is_dir: bool,
}

pub async fn list_uploaded_files_root() -> Result<Json<Vec<FileEntry>>, StatusCode> {
    let target_dir = PathBuf::from(UPLOAD_DIR.get().unwrap());

    if !target_dir.exists() || !target_dir.is_dir() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut entries = vec![];

    let mut dir_entries = match tokio::fs::read_dir(&target_dir).await {
        Ok(dir) => dir,
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    };

    while let Some(entry) = dir_entries
        .next_entry()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        if entry.file_name().to_string_lossy() == r"Work" {
            continue;
        }

        let metadata = entry
            .metadata()
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            size: if metadata.is_file() {
                metadata.len()
            } else {
                0
            },
            is_dir: metadata.is_dir(),
        });
    }

    Ok(Json(entries))
}

pub async fn list_uploaded_files(
    Path(dir_path): Path<String>,
) -> Result<Json<Vec<FileEntry>>, StatusCode> {
    let target_dir = clean_path(dir_path);

    if target_dir.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let target_dir = target_dir.unwrap();

    let mut entries = vec![];

    let mut dir_entries = match tokio::fs::read_dir(&target_dir).await {
        Ok(dir) => dir,
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    };

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
            size: if metadata.is_file() {
                metadata.len()
            } else {
                0
            },
            is_dir: metadata.is_dir(),
        });
    }

    Ok(Json(entries))
}
pub async fn download_file(Path(filename): Path<String>) -> Result<impl IntoResponse, StatusCode> {
    let mut path = PathBuf::from(UPLOAD_DIR.get().unwrap());

    path.push(&filename);

    if !path.exists() || !path.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }

    match File::open(&path).await {
        Ok(file) => {
            let stream = ReaderStream::new(file);
            let body = Body::from_stream(stream);
            let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();

            let mut headers = HeaderMap::new();

            if ext == "pdf" {
                headers.insert(
                    "Content-Disposition",
                    HeaderValue::from_str(&format!("inline; filename=\"{}\"", filename)).unwrap(),
                );
                headers.insert("Content-Type", HeaderValue::from_static("application/pdf"));
            } else {
                headers.insert(
                    "Content-Disposition",
                    HeaderValue::from_str(&format!("attachment; filename=\"{}\"", filename))
                        .unwrap(),
                );
            }

            Ok((headers, body).into_response())
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

pub async fn stream_video(
    Path(filename): Path<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {

    let mut path = PathBuf::from(UPLOAD_DIR.get().unwrap());
    path.push(&filename);

    if !path.exists() || !path.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }

    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let file_size = metadata.len();

    let range_header = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .filter(|s| s.starts_with("bytes="))
        .ok_or(StatusCode::RANGE_NOT_SATISFIABLE)?;

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
        .header(header::CONTENT_TYPE, "video/mp4")
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
