use serde::{Deserialize, Serialize};
use std::{env, fs, io, path::PathBuf};

#[derive(Serialize, Deserialize)]
pub struct Config {
    pub token: Option<String>,
    pub current_dir: String,
}

pub fn config_path() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(env::var("APPDATA").unwrap())
            .join("ghost")
            .join("config.json")
    } else {
        PathBuf::from(env::var("HOME").unwrap())
            .join(".config")
            .join("ghost")
            .join("config.json")
    }
}
pub fn load_config() -> Config {
    let path = config_path();

    if !path.exists() {
        let config = default_config();

        if let Err(e) = save_config(&config) {
            eprintln!("Failed to create config: {}", e);
        }

        return config;
    }

    let data = match fs::read_to_string(&path) {
        Ok(data) => data,
        Err(e) => {
            eprintln!("Failed to read config: {}", e);

            return default_config();
        }
    };

    match serde_json::from_str(&data) {
        Ok(config) => config,
        Err(e) => {
            eprintln!("Failed to parse config: {}", e);

            return default_config();
        }
    }
}

fn default_config() -> Config {
    Config {
        token: None,
        current_dir: "".to_string(),
    }
}

pub fn save_config(config: &Config) -> io::Result<()> {
    let path = config_path();

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let data = serde_json::to_string_pretty(config).map_err(io::Error::other)?;

    fs::write(path, data)?;

    Ok(())
}