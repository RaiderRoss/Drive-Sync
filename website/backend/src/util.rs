use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

pub static UPLOAD_DIR: OnceLock<String> = OnceLock::new();
pub const MAX_STORAGE_BYTES: u64 = 100 * 1024 * 1024 * 1024;
pub static HIDDEN_DIRS: OnceLock<Vec<String>> = OnceLock::new();
pub static JWT_SECRET: OnceLock<String> = OnceLock::new();
pub static JWT_DURATION_MINUTES: OnceLock<i64> = OnceLock::new();

pub fn clean_path(dir_path: String, user_id: String, is_admin: bool) -> Option<PathBuf> {
    let mut target_dir = PathBuf::from(get_user_path(user_id, is_admin));
    let mut clean_path = PathBuf::new();

    for component in Path::new(&dir_path).components() {
        match component {
            std::path::Component::Normal(part) => clean_path.push(part),
            _ => return None,
        }
    }

    target_dir = target_dir.join(clean_path);



    return Some(target_dir);
}

pub fn get_user_path(user_id: String, is_admin: bool) -> PathBuf {
    let mut path = PathBuf::from(UPLOAD_DIR.get().expect("UPLOAD_DIR not set"));

    if !is_admin {
        path.push(format!("{}", user_id));
    }

    path
}

pub fn initialize_config() {
    dotenv::dotenv().ok();

    UPLOAD_DIR
        .set(std::env::var("STORAGE_ROOT").unwrap())
        .expect("Failed to set UPLOAD_DIR");

    HIDDEN_DIRS
        .set(
            std::env::var("HIDDEN_DIRECTORIES")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        )
        .expect("Failed to set HIDDEN_DIRECTORIES");
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
