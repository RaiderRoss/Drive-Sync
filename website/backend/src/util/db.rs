//! # Database Utilities
//!
//! Provides database functions for managing users and shared files.
//!
//! This module handles:
//! - User creation, retrieval, and deletion.
//! - Shared file creation, retrieval, modification, and deletion.
//! - Checking whether files have already been shared.
//! - Retrieving shared files for individual users or all users.

use sqlx::{Row, SqlitePool};
use uuid::Uuid;

/// Creates a new user in the database.
///
/// A unique UUID is generated for the user. The username is checked before
/// insertion to ensure that a user with the same username does not already
/// exist.
///
/// # Arguments
///
/// * `db` - A reference to the SQLite connection pool.
/// * `username` - The username of the new user.
/// * `password_hash` - The securely hashed password of the new user.
/// * `is_admin` - Whether the new user should have administrator privileges.
///
/// # Returns
///
/// * `Ok(String)` - The UUID of the newly created user.
/// * `Err(sqlx::Error)` - If the username already exists or the database
///   operation fails.
///
/// # Examples
///
/// A regular user can be created by setting `is_admin` to `false`.
pub async fn create_user(
    db: &SqlitePool,
    username: &str,
    password_hash: &str,
    is_admin: bool,
) -> Result<String, sqlx::Error> {
    loop {
        let id = Uuid::new_v4().to_string();

        let user = get_user_by_username(db, username).await;

        if user.is_ok() {
            return Err(sqlx::Error::RowNotFound);
        }

        let result = sqlx::query(
            "INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(username)
        .bind(password_hash)
        .bind(is_admin)
        .execute(db)
        .await;

        match result {
            Ok(_) => return Ok(id),
            Err(sqlx::Error::Database(err)) if err.is_unique_violation() => {
                continue;
            }
            Err(err) => return Err(err),
        }
    }
}

/// Creates a new shared file record in the database.
///
/// The file itself is not copied or modified by this function. Only a record
/// describing the shared file is created.
///
/// # Arguments
///
/// * `db` - A reference to the SQLite connection pool.
/// * `owner_id` - The ID of the user who owns the shared file.
/// * `file_path` - The path of the file being shared.
///
/// # Returns
///
/// * `Ok(String)` - The UUID of the newly created shared file record.
/// * `Err(sqlx::Error)` - If the database operation fails.
pub async fn create_shared_file(
    db: &SqlitePool,
    owner_id: &str,
    file_path: &str,
) -> Result<String, sqlx::Error> {
    let id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO shared_files (id, owner_id, file_path) VALUES (?, ?, ?)",
    )
    .bind(&id)
    .bind(owner_id)
    .bind(file_path)
    .execute(db)
    .await?;

    Ok(id)
}

/// Checks whether a specific file has already been shared by a user.
///
/// # Arguments
///
/// * `db` - A reference to the SQLite connection pool.
/// * `owner_id` - The ID of the user who owns the file.
/// * `file_path` - The path of the file to check.
///
/// # Returns
///
/// * `Ok(true)` - If a matching shared file exists.
/// * `Ok(false)` - If no matching shared file exists.
/// * `Err(sqlx::Error)` - If the database query fails.
pub async fn check_shared_file_exists(
    db: &SqlitePool,
    owner_id: &str,
    file_path: &str,
) -> Result<bool, sqlx::Error> {
    let row = sqlx::query(
        "SELECT COUNT(*) FROM shared_files WHERE owner_id = ? AND file_path = ?",
    )
    .bind(owner_id)
    .bind(file_path)
    .fetch_one(db)
    .await?;

    let count: i64 = row.get(0);

    Ok(count > 0)
}

/// Deletes a shared file record from the database.
///
/// This removes the sharing record identified by the supplied ID. It does not
/// delete the underlying file from the user's storage.
///
/// # Arguments
///
/// * `db` - A reference to the SQLite connection pool.
/// * `id` - The ID of the shared file record to delete.
///
/// # Returns
///
/// * `Ok(())` - If the database operation completes successfully.
/// * `Err(sqlx::Error)` - If the database operation fails.
pub async fn delete_shared_file(
    db: &SqlitePool,
    id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM shared_files WHERE id = ?")
        .bind(id)
        .execute(db)
        .await?;

    Ok(())
}

/// Retrieves a shared file using its unique ID.
///
/// # Arguments
///
/// * `db` - A reference to the SQLite connection pool.
/// * `id` - The ID of the shared file record.
///
/// # Returns
///
/// A tuple containing:
///
/// * `String` - The ID of the user who owns the file.
/// * `String` - The path of the shared file.
/// * `i64` - The timestamp at which the file was shared.
///
/// Returns `Err(sqlx::Error)` if the record does not exist or the database
/// query fails.
pub async fn get_shared_file_by_id(
    db: &SqlitePool,
    id: &str,
) -> Result<(String, String, i64), sqlx::Error> {
    let row = sqlx::query(
        "SELECT owner_id, file_path, created_at FROM shared_files WHERE id = ?",
    )
    .bind(id)
    .fetch_one(db)
    .await?;

    let owner_id: String = row.get(0);
    let file_path: String = row.get(1);
    let created_at: i64 = row.get(2);

    Ok((owner_id, file_path, created_at))
}

/// Updates the path of a shared file and its descendants.
///
/// If the specified path represents a directory, all shared files and
/// directories underneath that path are updated to use the new path.
///
/// # Arguments
///
/// * `db` - A reference to the SQLite connection pool.
/// * `owner_id` - The ID of the user who owns the shared files.
/// * `file_path` - The current path of the file or directory.
/// * `new_file_path` - The new path to assign to the file or directory.
///
/// # Returns
///
/// * `Ok(())` - If the update completes successfully.
/// * `Err(sqlx::Error)` - If the database operation fails.
///
/// # Behavior
///
/// A file matching `file_path` is renamed directly to `new_file_path`.
/// Files contained within a directory are updated by replacing the old
/// directory prefix with the new directory prefix.
pub async fn change_shared_file_path(
    db: &SqlitePool,
    owner_id: &str,
    file_path: &str,
    new_file_path: &str,
) -> Result<(), sqlx::Error> {
    let prefix = format!("{file_path}/");

    sqlx::query(
        "UPDATE shared_files
         SET file_path = CASE
             WHEN file_path = ?1 THEN ?2
             ELSE ?2 || '/' || substr(file_path, length(?3) + 1)
         END
         WHERE owner_id = ?4
           AND (file_path = ?1 OR substr(file_path, 1, length(?3)) = ?3)",
    )
    .bind(file_path)
    .bind(new_file_path)
    .bind(&prefix)
    .bind(owner_id)
    .execute(db)
    .await?;

    Ok(())
}

/// Retrieves a user using their username.
///
/// # Arguments
///
/// * `db` - A reference to the SQLite connection pool.
/// * `username` - The username of the user to retrieve.
///
/// # Returns
///
/// A tuple containing:
///
/// * `String` - The user's unique ID.
/// * `String` - The user's password hash.
/// * `bool` - Whether the user has administrator privileges.
///
/// Returns `Err(sqlx::Error)` if the user does not exist or the database
/// query fails.
pub async fn get_user_by_username(
    db: &SqlitePool,
    username: &str,
) -> Result<(String, String, bool), sqlx::Error> {
    let row = sqlx::query(
        "SELECT id, password_hash, is_admin FROM users WHERE username = ?",
    )
    .bind(username)
    .fetch_one(db)
    .await?;

    let id: String = row.get(0);
    let hash: String = row.get(1);
    let is_admin: bool = row.get(2);

    Ok((id, hash, is_admin))
}

/// Retrieves all users from the database.
///
/// # Arguments
///
/// * `db` - A reference to the SQLite connection pool.
///
/// # Returns
///
/// * `Ok(Vec<(String, String)>)` - A vector containing the ID and username
///   of every user.
/// * `Err(sqlx::Error)` - If the database query fails.
///
/// Each tuple contains:
///
/// * `String` - The user's unique ID.
/// * `String` - The user's username.
pub async fn get_all_users(
    db: &SqlitePool,
) -> Result<Vec<(String, String)>, sqlx::Error> {
    let rows = sqlx::query("SELECT id, username FROM users")
        .fetch_all(db)
        .await?;

    let users = rows
        .into_iter()
        .map(|row| {
            let id: String = row.get("id");
            let username: String = row.get("username");

            (id, username)
        })
        .collect();

    Ok(users)
}

/// Deletes a user from the database.
///
/// # Arguments
///
/// * `user_id` - The ID of the user to delete.
/// * `db` - A reference to the SQLite connection pool.
///
/// # Returns
///
/// * `Ok(())` - If the user was successfully deleted.
/// * `Err(sqlx::Error)` - If the database operation fails.
pub async fn delete_user(
    user_id: &str,
    db: &SqlitePool,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(user_id)
        .execute(db)
        .await?;

    Ok(())
}

/// Retrieves shared files from the database.
///
/// If an owner ID is provided, only files belonging to that user are returned.
/// If no owner ID is provided, shared files belonging to all users are
/// returned.
///
/// # Arguments
///
/// * `db` - A reference to the SQLite connection pool.
/// * `owner_id` - An optional user ID used to filter the results. If `None`,
///   shared files belonging to all users are returned.
///
/// # Returns
///
/// A vector of tuples containing:
///
/// * `String` - The username of the file owner.
/// * `String` - The ID of the shared file record.
/// * `String` - The path of the shared file.
/// * `i64` - The timestamp at which the file was shared.
///
/// Returns `Err(sqlx::Error)` if the database query fails.
pub async fn get_shares(
    db: &SqlitePool,
    owner_id: Option<&str>,
) -> Result<Vec<(String, String, String, i64)>, sqlx::Error> {
    let rows = if owner_id.is_none() {
        sqlx::query(
            r#"
            SELECT
                u.username,
                s.id,
                s.file_path,
                s.created_at
            FROM shared_files s
            INNER JOIN users u ON s.owner_id = u.id
            "#,
        )
        .fetch_all(db)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT
                u.username,
                s.id,
                s.file_path,
                s.created_at
            FROM shared_files s
            INNER JOIN users u ON s.owner_id = u.id
            WHERE s.owner_id = ?
            "#,
        )
        .bind(owner_id.unwrap())
        .fetch_all(db)
        .await?
    };

    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.get("username"),
                row.get("id"),
                row.get("file_path"),
                row.get("created_at"),
            )
        })
        .collect())
}
