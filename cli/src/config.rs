//! Configuration management for the application.
//! 
//! This module provides functionality to load, save, and manage the application's configuration settings.

use serde::{Deserialize, Serialize};
use std::{env, fs, io, path::PathBuf};

/// Struct representing the application's configuration settings.
/// # Example
/// ```
/// let config = Config {
///     token: Some("your_token".to_string()),
///     current_dir: "/path/to/directory".to_string(),
/// };
/// 
#[derive(Serialize, Deserialize)]
pub struct Config {
    /// String representing the JWT token for the application.
    pub token: Option<String>,
    /// Represents the current working directory as a string.
    pub current_dir: String,
}

/// Returns the path to the configuration file based on the operating system.
///
/// # Returns
///
/// The path to the configuration file as a [`PathBuf`].
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


/// Loads the configuration from the configuration file.
///
/// If the configuration file does not exist, it creates a default configuration
/// and saves it to the file. If the file exists but cannot be read or parsed,
/// it returns a default configuration.
/// # Returns
/// The loaded configuration as a [`Config`] struct.
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

/// Creates a default configuration with no token and an empty current directory.
/// # Returns
/// A [`Config`] struct with default values.
fn default_config() -> Config {
    Config {
        token: None,
        current_dir: "".to_string(),
    }
}

/// Saves the provided configuration to the configuration file.
/// # Arguments
/// * `config` - A reference to the [`Config`] struct to be saved.
/// # Returns
/// An [`io::Result`] indicating success or failure of the save operation.

pub fn save_config(config: &Config) -> io::Result<()> {
    let path = config_path();

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let data = serde_json::to_string_pretty(config).map_err(io::Error::other)?;

    fs::write(path, data)?;

    Ok(())
}