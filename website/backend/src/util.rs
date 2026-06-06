use std::{
    fs::OpenOptions, io::Write, path::{Path, PathBuf}, sync::OnceLock
};

pub static UPLOAD_DIR: OnceLock<String> = OnceLock::new();
pub static LOG_FILE: OnceLock<String> = OnceLock::new();
pub const MAX_STORAGE_BYTES: u64 = 100 * 1024 * 1024 * 1024;
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

    LOG_FILE
        .set(format!("{}/{}", UPLOAD_DIR.get().unwrap(), std::env::var("LOG_FILE").unwrap()))
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
