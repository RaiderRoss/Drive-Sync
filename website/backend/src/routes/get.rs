//! # File and Archive Retrieval Utilities
//!
//! This module provides handlers and helper functions for retrieving files,
//! listing directories, serving shared files, downloading files, streaming
//! video content, inspecting archive contents, and calculating directory
//! storage usage.
//!
//! The module supports:
//!
//! - Listing uploaded files and directories.
//! - Listing files shared by the authenticated user.
//! - Retrieving files through share links.
//! - Downloading files.
//! - Streaming video files.
//! - Supporting HTTP byte-range requests for video playback.
//! - Inspecting ZIP, TAR, TAR.GZ, TGZ, and GZ archives.
//! - Calculating the total size of a directory.
//!
//! File paths are resolved relative to the authenticated user's storage
//! directory where applicable.

use crate::AppState;

use crate::routes::auth::AuthUser;

use crate::util::{
    db::{get_shared_file_by_id, get_shares},
    util::{clean_path, get_user_path},
};

use axum::Extension;

use axum::extract::State;

use axum::{
    Json,
    body::Body,
    extract::Path,
    http::{HeaderMap, HeaderValue, Response, StatusCode, header},
    response::IntoResponse,
};

use flate2::read::GzDecoder;

use futures::StreamExt;

use rayon::prelude::*;

use serde::Serialize;

use std::io::Read;

use std::{fs, io, path::PathBuf, time::UNIX_EPOCH};

use tar::Archive as TarArchive;

use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt},
    task,
};

use tokio_util::io::ReaderStream;

use zip::ZipArchive;

/// Represents a file or directory returned by the file listing endpoint.
///
/// This structure is serialized into JSON and contains metadata describing
/// an entry in the authenticated user's storage directory.
#[derive(Serialize)]
pub struct FileEntry {
    /// The name of the file or directory.
    name: String,

    /// The size of the file in bytes.
    ///
    /// Directories have a size of `0`.
    size: u64,

    /// Indicates whether the entry is a directory.
    is_dir: bool,

    /// The last modification time as the number of seconds since
    /// [`UNIX_EPOCH`].
    date_modified: u64,

    /// The lowercase file extension.
    ///
    /// For directories, this is `"folder"`.
    file_type: String,
}

/// Lists the files and directories contained within a user's storage directory.
///
/// The requested path is cleaned and validated before the directory is read.
/// When no path is provided, the authenticated user's root storage directory
/// is listed.
///
/// # Arguments
///
/// * `Extension(AuthUser(claims))` - Authentication information containing the
///   authenticated user's ID.
/// * `path` - Optional directory path to list.
///
/// # Returns
///
/// Returns a JSON array containing [`FileEntry`] values describing each entry
/// in the requested directory.
///
/// # Errors
///
/// Returns [`StatusCode::BAD_REQUEST`] when the requested path is invalid or
/// when the user's root directory does not exist or is not a directory.
///
/// Returns [`StatusCode::NOT_FOUND`] when a non-root directory does not exist.
///
/// Returns [`StatusCode::INTERNAL_SERVER_ERROR`] when the directory or its
/// metadata cannot be read.
pub async fn list_uploaded_files(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    path: Option<Path<String>>,
) -> Result<Json<Vec<FileEntry>>, StatusCode> {

    let target_dir = match path {
        Some(Path(p)) => clean_path(p, claims.user.clone()).ok_or(StatusCode::BAD_REQUEST)?,
        None => get_user_path(claims.user.clone()),
    };

    let user_root = get_user_path(claims.user.clone());

    if !target_dir.exists() || !target_dir.is_dir() {
        return Err(match target_dir == user_root {
            true => StatusCode::BAD_REQUEST,
            false => StatusCode::NOT_FOUND,
        });
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
            size: metadata.is_file().then_some(metadata.len()).unwrap_or(0),
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

/// Represents a shared file returned by the shared-file listing endpoint.
///
/// This structure contains the identifier of the share, the path of the
/// shared file, and the time at which the share was created.
#[derive(Serialize)]
pub struct ShareEntryResponse {
    /// The unique identifier of the shared file.
    id: String,

    /// The path of the shared file relative to the owner's storage directory.
    file_path: String,

    /// The Unix timestamp at which the share was created.
    created_at: i64,
}

/// Represents an entry contained within an archive.
///
/// Archive entries are returned when inspecting supported archive formats.
#[derive(Serialize)]
pub struct ArchiveEntryResponse {
    /// The path of the entry within the archive.
    path: String,

    /// The size of the archive entry in bytes.
    size: u64,

    /// Indicates whether the archive entry is a directory.
    is_dir: bool,
}

/// Determines the archive type from a filename.
///
/// Special handling is provided for multi-extension archive formats such as
/// `.tar.gz` and `.tgz`.
///
/// # Arguments
///
/// * `filename` - The filename whose extension should be determined.
///
/// # Returns
///
/// Returns the archive extension in lowercase.
fn archive_extension(filename: &str) -> String {
    let lower = filename.to_lowercase();

    if lower.ends_with(".tar.gz") {
        return "tar.gz".to_string();
    }

    if lower.ends_with(".tgz") {
        return "tgz".to_string();
    }

    filename.rsplit('.').next().unwrap_or("").to_lowercase()
}

/// Determines whether an archive entry should be included in the listing.
///
/// Only entries with a maximum depth of two path components are retained.
/// This prevents excessively deep archive contents from being returned by
/// the archive listing endpoint.
///
/// # Arguments
///
/// * `path` - The path of the archive entry.
///
/// # Returns
///
/// Returns `true` when the entry is at a depth of two or less.
fn keep_entry(path: &str) -> bool {
    let path = path.trim_end_matches('/');

    let depth = path.split('/').filter(|s| !s.is_empty()).count();

    depth <= 2
}

/// Reads the contents of a supported archive and returns its entries.
///
/// Supported formats are:
///
/// - ZIP
/// - TAR
/// - TAR.GZ
/// - TGZ
/// - GZ
///
/// For regular archives, only entries accepted by [`keep_entry`] are
/// returned. GZ files are treated as single compressed files and their
/// decompressed size is calculated by reading the entire stream.
///
/// # Arguments
///
/// * `path` - Path to the archive on disk.
/// * `filename` - Original archive filename used to determine its format.
///
/// # Returns
///
/// Returns a vector of [`ArchiveEntryResponse`] values describing the
/// archive contents.
///
/// # Errors
///
/// Returns [`StatusCode::BAD_REQUEST`] when the archive format is unsupported
/// or the archive cannot be parsed.
///
/// Returns [`StatusCode::INTERNAL_SERVER_ERROR`] when the archive cannot be
/// opened.
fn read_archive_entries(
    path: &PathBuf,
    filename: &str,
) -> Result<Vec<ArchiveEntryResponse>, StatusCode> {

    match archive_extension(filename).as_str() {
        "zip" => {
            let file = fs::File::open(path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let mut archive = ZipArchive::new(file).map_err(|_| StatusCode::BAD_REQUEST)?;

            let mut entries = Vec::with_capacity(archive.len());

            for index in 0..archive.len() {
                let file = archive
                    .by_index(index)
                    .map_err(|_| StatusCode::BAD_REQUEST)?;

                let path = file.name();

                if !keep_entry(path) {
                    continue;
                }

                entries.push(ArchiveEntryResponse {
                    path: file.name().to_string(),
                    size: file.size(),
                    is_dir: file.is_dir(),
                });
            }

            Ok(entries)
        }

        "tar" => {
            let file = fs::File::open(path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let mut archive = TarArchive::new(file);

            let mut entries = Vec::new();

            for entry in archive.entries().map_err(|_| StatusCode::BAD_REQUEST)? {
                let entry = entry.map_err(|_| StatusCode::BAD_REQUEST)?;

                let path = entry
                    .path()
                    .map_err(|_| StatusCode::BAD_REQUEST)?
                    .to_string_lossy()
                    .to_string();

                if !keep_entry(&path) {
                    continue;
                }

                entries.push(ArchiveEntryResponse {
                    path,
                    size: entry.size(),
                    is_dir: entry.header().entry_type().is_dir(),
                });
            }

            Ok(entries)
        }

        "tar.gz" | "tgz" => {
            let file = fs::File::open(path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let decoder = GzDecoder::new(file);

            let mut archive = TarArchive::new(decoder);

            let mut entries = Vec::new();

            for entry in archive.entries().map_err(|_| StatusCode::BAD_REQUEST)? {
                let entry = entry.map_err(|_| StatusCode::BAD_REQUEST)?;

                let path = entry
                    .path()
                    .map_err(|_| StatusCode::BAD_REQUEST)?
                    .to_string_lossy()
                    .to_string();

                if !keep_entry(&path) {
                    continue;
                }

                entries.push(ArchiveEntryResponse {
                    path,
                    size: entry.size(),
                    is_dir: entry.header().entry_type().is_dir(),
                });
            }

            Ok(entries)
        }

        "gz" => {
            let file = fs::File::open(path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let mut decoder = GzDecoder::new(file);

            let mut size = 0u64;

            let mut buffer = [0u8; 8192];

            loop {
                let read = decoder
                    .read(&mut buffer)
                    .map_err(|_| StatusCode::BAD_REQUEST)?;

                if read == 0 {
                    break;
                }

                size += read as u64;
            }

            let inner_name = filename.strip_suffix(".gz").unwrap_or(filename).to_string();

            Ok(vec![ArchiveEntryResponse {
                path: inner_name,
                size,
                is_dir: false,
            }])
        }

        _ => Err(StatusCode::BAD_REQUEST),
    }
}

/// Reads archive entries on a blocking thread.
///
/// Archive parsing performs synchronous file operations and may involve
/// significant I/O. This helper executes [`read_archive_entries`] using
/// Tokio's blocking task pool so that the asynchronous runtime is not blocked.
///
/// # Arguments
///
/// * `path` - Path to the archive.
/// * `filename` - Filename used to determine the archive format.
///
/// # Returns
///
/// Returns the archive entries serialized as JSON.
///
/// # Errors
///
/// Returns [`StatusCode::INTERNAL_SERVER_ERROR`] if the blocking task fails
/// to execute.
///
/// Returns any status code generated by [`read_archive_entries`].
async fn archive_entries_for_path(
    path: PathBuf,
    filename: String,
) -> Result<Json<Vec<ArchiveEntryResponse>>, StatusCode> {
    let entries = task::spawn_blocking(move || read_archive_entries(&path, &filename))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    Ok(Json(entries))
}

/// Lists the contents of an archive stored in the authenticated user's
/// storage directory.
///
/// The archive filename is resolved relative to the user's storage root and
/// inspected using [`archive_entries_for_path`].
///
/// # Arguments
///
/// * `Extension(AuthUser(claims))` - Authentication information containing the
///   authenticated user's ID.
/// * `Path(filename)` - The archive filename to inspect.
///
/// # Returns
///
/// Returns a JSON array containing the entries contained in the archive.
///
/// # Errors
///
/// Returns [`StatusCode::NOT_FOUND`] when the requested file does not exist
/// or is not a regular file.
///
/// Returns errors returned by the archive parsing process.
pub async fn list_archive_entries(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    Path(filename): Path<String>,
) -> Result<Json<Vec<ArchiveEntryResponse>>, StatusCode> {
    let mut path = get_user_path(claims.user);

    path.push(&filename);

    if !path.exists() || !path.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }

    archive_entries_for_path(path, filename).await
}

/// Lists all files shared by the authenticated user.
///
/// The shared-file records are retrieved from the database and converted
/// into [`ShareEntryResponse`] values before being returned as JSON.
///
/// # Arguments
///
/// * `Extension(AuthUser(claims))` - Authentication information containing
///   the authenticated user's ID.
/// * `State(state)` - Application state containing the database connection.
///
/// # Returns
///
/// Returns a JSON array containing the authenticated user's shared files.
///
/// # Errors
///
/// Returns [`StatusCode::INTERNAL_SERVER_ERROR`] when the database query
/// fails.
pub async fn list_shared_files(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    State(state): State<AppState>,
) -> Result<Json<Vec<ShareEntryResponse>>, StatusCode> {
    let shares = get_shares(&state.db, Some(&claims.user))
        .await
        .map_err(|e| {
            eprintln!("list_shared_files: db error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(
        shares
            .into_iter()
            .map(|s| ShareEntryResponse {
                id: s.1,
                file_path: s.2,
                created_at: s.3,
            })
            .collect(),
    ))
}

/// Retrieves a file through a shared-file identifier.
///
/// The share identifier is resolved through the database to determine the
/// owning user and file path. The file is then served from the owner's
/// storage directory.
///
/// Video files are served through [`serve_video`] to support streaming and
/// HTTP byte-range requests. Other files are served through [`serve_file`].
///
/// # Arguments
///
/// * `Path(id)` - The unique identifier of the shared file.
/// * `State(state)` - Application state containing the database connection.
/// * `headers` - HTTP request headers, including an optional `Range` header
///   for video requests.
///
/// # Returns
///
/// Returns the requested file as an HTTP response.
///
/// Returns `404 Not Found` when the share identifier is invalid or the
/// underlying file does not exist.
///
/// # Errors
///
/// Database failures result in an internal server error response.
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

    let (owner_id, file_path, _) = filename.unwrap();

    let path = get_user_path(owner_id).join(&file_path);

    if !path.exists() || !path.is_file() {
        return Ok((StatusCode::NOT_FOUND, "File not found").into_response());
    }

    let ext = file_path.rsplit('.').next().unwrap_or("").to_lowercase();

    if matches!(ext.as_str(), "mp4" | "webm" | "mkv" | "avi") {
        return serve_video(path, headers, &ext)
            .await
            .map(|r| r.into_response());
    }

    serve_file(path, file_path).await.map(|r| r.into_response())
}

/// Downloads a file belonging to the authenticated user.
///
/// The requested filename is resolved relative to the user's storage
/// directory. The file is then passed to [`serve_file`] for streaming.
///
/// # Arguments
///
/// * `Extension(AuthUser(claims))` - Authentication information containing
///   the authenticated user's ID.
/// * `Path(filename)` - The name or relative path of the file to download.
///
/// # Returns
///
/// Returns the requested file as an HTTP response.
///
/// # Errors
///
/// Returns [`StatusCode::NOT_FOUND`] when the requested path does not exist
/// or does not refer to a regular file.
///
/// Returns [`StatusCode::INTERNAL_SERVER_ERROR`] if the file cannot be served.
pub async fn download_file(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    Path(filename): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let mut path = get_user_path(claims.user);

    path.push(&filename);

    if !path.exists() || !path.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }

    serve_file(path, filename).await
}

/// Determines the MIME type corresponding to a file extension.
///
/// The function provides explicit MIME types for commonly used document,
/// image, audio, video, and source-code formats. Unknown extensions are
/// treated as binary data.
///
/// # Arguments
///
/// * `ext` - The lowercase file extension.
///
/// # Returns
///
/// Returns the MIME type as a static string suitable for use in an HTTP
/// `Content-Type` header.
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

/// Serves a file as an HTTP response.
///
/// The file is opened asynchronously and streamed to the client using
/// [`ReaderStream`]. The `Content-Type` header is determined from the
/// filename extension.
///
/// Files that can normally be displayed by a browser, such as PDFs, images,
/// videos, and audio files, are served with `inline` content disposition.
/// Other file types are served as attachments.
///
/// # Arguments
///
/// * `path` - Filesystem path to the file.
/// * `filename` - Filename used to determine the MIME type and response
///   filename.
///
/// # Returns
///
/// Returns an HTTP response containing the file stream.
///
/// # Errors
///
/// Returns [`StatusCode::INTERNAL_SERVER_ERROR`] when the file cannot be
/// opened.
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

            headers.insert("Content-Type", HeaderValue::from_str(content_type).unwrap());

            let response = (headers, body).into_response();

            Ok(response)
        }

        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// Streams a video file belonging to the authenticated user.
///
/// The requested file is resolved relative to the user's storage directory.
/// Video data is passed to [`serve_video`], which handles both normal
/// responses and HTTP byte-range requests.
///
/// # Arguments
///
/// * `Extension(AuthUser(claims))` - Authentication information containing
///   the authenticated user's ID.
/// * `Path(filename)` - The video filename or relative path.
/// * `headers` - HTTP request headers, including an optional `Range` header.
///
/// # Returns
///
/// Returns an HTTP response containing the video stream.
///
/// # Errors
///
/// Returns [`StatusCode::NOT_FOUND`] when the requested video does not exist
/// or is not a regular file.
///
/// Returns [`StatusCode::INTERNAL_SERVER_ERROR`] when the video cannot be
/// opened or streamed.
pub async fn stream_video(
    Extension(AuthUser(claims)): Extension<AuthUser>,
    Path(filename): Path<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    let mut path = get_user_path(claims.user);

    path.push(&filename);

    if !path.exists() || !path.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }

    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();

    serve_video(path, headers, &ext).await
}

/// Serves a video file with support for HTTP byte-range requests.
///
/// If the request does not contain a valid `Range` header, the entire file
/// is streamed with a normal `200 OK` response.
///
/// When a byte range is supplied, only the requested portion of the file is
/// streamed and a `206 Partial Content` response is returned. This allows
/// clients such as web browsers to seek through video files without
/// downloading the entire file.
///
/// # Arguments
///
/// * `path` - Filesystem path to the video file.
/// * `headers` - HTTP request headers used to inspect the optional `Range`
///   header.
/// * `ext` - Lowercase file extension used to determine the MIME type.
///
/// # Returns
///
/// Returns an HTTP response containing the requested video data.
///
/// The response includes appropriate `Content-Type`, `Content-Length`,
/// `Accept-Ranges`, and, for partial responses, `Content-Range` headers.
///
/// # Errors
///
/// Returns [`StatusCode::INTERNAL_SERVER_ERROR`] when the file metadata,
/// file handle, seeking operation, or response construction fails.
///
/// Returns [`StatusCode::RANGE_NOT_SATISFIABLE`] when the requested byte
/// range falls outside the file.
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

    let start: u64 = parts.first().and_then(|v| v.parse().ok()).unwrap_or(0);

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

    let stream = ReaderStream::with_capacity(file.take(chunk_size), 16 * 1024)
        .map(|r| r.map_err(|_| std::io::Error::from(std::io::ErrorKind::Other)));

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

/// Calculates the total size of all files contained within a directory.
///
/// The directory is traversed recursively. File sizes are summed using
/// Rayon to parallelize processing of directory entries.
///
/// On Windows, the `$RECYCLE.BIN` and `System Volume Information` directories
/// are skipped.
///
/// Files or directories whose metadata cannot be read are ignored and
/// contribute zero bytes to the result.
///
/// # Arguments
///
/// * `path` - The directory whose contents should be measured.
///
/// # Returns
///
/// Returns the total size of all files contained within the directory,
/// including files in nested subdirectories.
///
/// Returns `0` for a directory that cannot be read.
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
                    if let Some(name) = path.file_name().and_then(|n| n.to_str())
                        && (name.eq_ignore_ascii_case("$RECYCLE.BIN")
                            || name.eq_ignore_ascii_case("System Volume Information"))
                    {
                        return 0;
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
