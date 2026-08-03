use sqlx::{Row, SqlitePool};

pub async fn get_all_users(db: &SqlitePool) -> Result<Vec<(String, String)>, sqlx::Error> {
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

pub async fn delete_user(user_id: &str, db: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(user_id)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn get_shares(
    db: &SqlitePool,
) -> Result<Vec<(String, String, String, i64)>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT
            u.username,
            s.id,
            s.file_path,
            s.created_at
            FROM shared_files s
            INNER JOIN users u
            ON s.owner_id = u.id
        "#,
    )
    .fetch_all(db)
    .await?;

    let shares = rows
        .into_iter()
        .map(|row| {
            let username: String = row.get("username");
            let id: String = row.get("id");
            let file_path: String = row.get("file_path");
            let created_at: i64 = row.get("created_at");

            (username, id, file_path, created_at)
        })
        .collect();

    Ok(shares)
}