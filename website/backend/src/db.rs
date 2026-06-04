use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub async fn setup_db(db: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        " CREATE TABLE IF NOT EXISTS users ( id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, is_admin BOOLEAN NOT NULL) ",
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn create_user(
    db: &SqlitePool,
    username: &str,
    password_hash: &str,
    is_admin: bool,
) -> Result<String, sqlx::Error> {
    loop {
        println!("Attempting to create user: {}", username);
        let id = Uuid::new_v4().to_string();
        let user = get_user_by_username(db, username).await;
        
        if user.is_ok() {
            return Err(sqlx::Error::RowNotFound);
        }
        
        let result =
            sqlx::query("INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, ?, ?)")
                .bind(&id)
                .bind(username)
                .bind(password_hash)
                .bind(is_admin)
                .execute(db)
                .await;

        match result {
            Ok(_) => return Ok(id),
            Err(sqlx::Error::Database(err)) if err.is_unique_violation() => {
                println!("UUID collision detected, retrying...");
                continue;
            }
            Err(err) => return Err(err),
        }
    }
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
