//! # File Storage Utilities
//!
//! Provides utility functions and global configuration values used by the
//! file storage service.
//!
//! This module handles:
//! - Storage path management.
//! - Path sanitisation.
//! - Application configuration initialisation.
//! - Action logging.
//! - Database migration setup.

use std::{
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use sqlx::SqlitePool;

/// Root directory used for storing uploaded files.
pub static UPLOAD_DIR: OnceLock<String> = OnceLock::new();

/// Path to the file used for storing application action logs.
pub static LOG_FILE: OnceLock<String> = OnceLock::new();

/// Maximum amount of storage that can be used by the file storage service.
///
/// The limit is set to 100 GiB.
pub const MAX_STORAGE_BYTES: u64 = 100 * 1024 * 1024 * 1024;

/// Secret key used for signing and verifying JSON Web Tokens (JWTs).
pub static JWT_SECRET: OnceLock<String> = OnceLock::new();

/// Default duration, in minutes, for which issued JSON Web Tokens remain valid.
pub static JWT_DURATION_MINUTES: OnceLock<i64> = OnceLock::new();

/// Sanitises a directory path and resolves it within a user's storage directory.
///
/// The provided path is broken into its individual components. Only normal
/// path components are accepted. Components such as `.`, `..`, root paths,
/// and platform-specific prefixes cause the function to return `None`.
///
/// This prevents a user-supplied path from escaping their designated storage
/// directory.
///
/// # Arguments
///
/// * `dir_path` - The directory path supplied by the user.
/// * `user_id` - The ID of the user whose storage directory should be used.
///
/// # Returns
///
/// * `Some(PathBuf)` - The sanitised path within the user's storage directory.
/// * `None` - If the supplied path contains an invalid path component.
///
/// # Examples
///
/// A path such as `documents/reports` is resolved relative to the user's
/// storage directory:
///
/// ```text
/// <storage_root>/<user_id>/documents/reports
/// ```
pub fn clean_path(dir_path: String, user_id: String) -> Option<PathBuf> {
    let mut target_dir = get_user_path(user_id);
    let mut clean_path = PathBuf::new();

    for component in Path::new(&dir_path).components() {
        match component {
            std::path::Component::Normal(part) => clean_path.push(part),
            _ => return None,
        }
    }

    target_dir = target_dir.join(clean_path);

    Some(target_dir)
}

/// Returns the root storage directory for a specific user.
///
/// The user's ID is appended to [`UPLOAD_DIR`] to create an isolated storage
/// directory for that user.
///
/// # Arguments
///
/// * `user_id` - The ID of the user whose storage path should be returned.
///
/// # Returns
///
/// A [`PathBuf`] containing the user's storage directory.
///
/// # Panics
///
/// Panics if [`UPLOAD_DIR`] has not been initialised before this function is
/// called.
pub fn get_user_path(user_id: String) -> PathBuf {
    let mut path = PathBuf::from(UPLOAD_DIR.get().expect("UPLOAD_DIR not set"));

    path.push(&user_id);

    path
}

/// Initialises the global configuration values used by the service.
///
/// Configuration values are loaded from environment variables, with values
/// from a `.env` file loaded when available.
///
/// The following environment variables are used:
///
/// * `STORAGE_ROOT` - Root directory for uploaded files.
/// * `LOG_FILE` - Name of the action log file.
/// * `JWT_SECRET` - Secret key used for JWT authentication.
/// * `JWT_DURATION_MINUTES` - JWT validity duration in minutes. Defaults to
///   `60` when not specified.
///
/// # Panics
///
/// Panics if a required environment variable is missing, if a global value
/// has already been initialised, or if `JWT_DURATION_MINUTES` contains an
/// invalid integer.
pub fn initialize_config() {
    dotenv::dotenv().ok();

    UPLOAD_DIR
        .set(std::env::var("STORAGE_ROOT").unwrap())
        .expect("Failed to set UPLOAD_DIR");

    LOG_FILE
        .set(format!(
            "{}/{}",
            UPLOAD_DIR.get().unwrap(),
            std::env::var("LOG_FILE").unwrap()
        ))
        .expect("Failed to set LOG_FILE");

    JWT_SECRET
        .set(std::env::var("JWT_SECRET").unwrap())
        .expect("Failed to set JWT_SECRET");

    JWT_DURATION_MINUTES
        .set(
            std::env::var("JWT_DURATION_MINUTES")
                .unwrap_or_else(|_| "60".to_string())
                .parse()
                .expect("Invalid JWT_DURATION_MINUTES"),
        )
        .expect("Failed to set JWT_DURATION_MINUTES");
}

/// Records a user action in the application's log file.
///
/// Each log entry contains the timestamp, user ID, action, and affected path
/// in comma-separated format.
///
/// # Arguments
///
/// * `user_id` - The ID of the user performing the action.
/// * `action` - The action being performed, such as `upload`, `delete`, or
///   `rename`.
/// * `path` - The file or directory path affected by the action.
///
/// # Log Format
///
/// Log entries are written using the following format:
///
/// ```text
/// timestamp,user_id,action,path
/// ```
///
/// The timestamp is recorded as the number of seconds since the Unix epoch.
///
/// # Panics
///
/// Panics if [`LOG_FILE`] has not been initialised, if the log file cannot
/// be opened, or if the log entry cannot be written.
pub fn log_actions(user_id: String, action: String, path: String) {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let log_entry = format!("{},{},{},{}\n", timestamp, user_id, action, path);

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(LOG_FILE.get().expect("LOG_FILE not set"))
        .unwrap();

    file.write_all(log_entry.as_bytes()).unwrap();
}

/// Runs all pending SQLx database migrations.
///
/// This function applies migrations embedded into the application using
/// [`sqlx::migrate!`].
///
/// # Arguments
///
/// * `db` - A reference to the SQLite connection pool used to execute the
///   migrations.
///
/// # Returns
///
/// * `Ok(())` - All pending migrations were successfully applied.
/// * `Err(sqlx::Error)` - A database or migration error occurred.
pub async fn setup_db(db: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::migrate!().run(db).await?;

    Ok(())
}

