use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub async fn setup_db(db: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::migrate!().run(db).await?;
    Ok(())
}

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

pub async fn create_shared_file(
    db: &SqlitePool,
    owner_id: &str,
    file_path: &str,
) -> Result<String, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO shared_files (id, owner_id, file_path) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(owner_id)
        .bind(file_path)
        .execute(db)
        .await?;
    Ok(id)
}

pub async fn check_shared_file_exists(db: &SqlitePool, owner_id: &str, file_path: &str) -> Result<bool, sqlx::Error> {
    let row = sqlx::query("SELECT COUNT(*) FROM shared_files WHERE owner_id = ? AND file_path = ?")
        .bind(owner_id)
        .bind(file_path)
        .fetch_one(db)
        .await?;
    let count: i64 = row.get(0);
    Ok(count > 0)
}

pub async fn delete_shared_file(db: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM shared_files WHERE id = ?")
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn get_shares(
    db: &SqlitePool,
    owner_id: &str,
) -> Result<Vec<(String, String, i64)>, sqlx::Error> {
    let rows = sqlx::query("SELECT id, file_path, created_at FROM shared_files WHERE owner_id = ?")
        .bind(owner_id)
        .fetch_all(db)
        .await?;
 
    let shares = rows
        .into_iter()
        .map(|row| {
            let id: String = row.get(0);
            let file_path: String = row.get(1);
            let created_at: i64 = row.get(2);
            Ok((id, file_path, created_at))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;
 
    Ok(shares)
}
 
 

pub async fn get_shared_file_by_id(
    db: &SqlitePool,
    id: &str,
) -> Result<(String, String), sqlx::Error> {
    let row = sqlx::query("SELECT owner_id, file_path FROM shared_files WHERE id = ?")
        .bind(id)
        .fetch_one(db)
        .await?;
    let owner_id: String = row.get(0);
    let file_path: String = row.get(1);
    Ok((owner_id, file_path))
}

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
 
pub async fn get_user_by_username(
    db: &SqlitePool,
    username: &str,
) -> Result<(String, String, bool), sqlx::Error> {
    let row = sqlx::query("SELECT id, password_hash, is_admin FROM users WHERE username = ?")
        .bind(username)
        .fetch_one(db)
        .await?;
    let id: String = row.get(0);
    let hash: String = row.get(1);
    let is_admin: bool = row.get(2);
    Ok((id, hash, is_admin))
}
