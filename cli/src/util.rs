//! # CLI Utility Functions
//!
//! This module provides utility functions used throughout the CLI application.
//!
//! It includes functionality for:
//! - Authenticating users and storing authentication tokens.
//! - Listing files and directories from the cloud storage service.
//! - Formatting file sizes into human-readable units.
//! - Formatting Unix timestamps into readable dates.
//! - Deleting, renaming, moving, and copying files or directories.

use std::io::{self, Write};

use crate::colour::Colour;
use crate::print;
use crate::println;

use chrono::{Local, TimeZone};
use login_handler::read_password;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    config::{self, save_config},
    login_handler,
};

/// Represents a file or directory returned by the cloud storage API.
///
/// This structure is deserialized from the JSON response returned by
/// the file listing endpoint.
#[derive(Deserialize)]
struct Entry {
    /// The name of the file or directory.
    name: String,

    /// The size of the file in bytes.
    ///
    /// Directories may report a size of zero.
    size: u64,

    /// Indicates whether the entry is a directory.
    ///
    /// `true` indicates a directory, while `false` indicates a regular file.
    is_dir: bool,

    /// The Unix timestamp representing when the entry was last modified.
    date_modified: i64,

    /// The type of the file.
    ///
    /// This may be empty for files whose type could not be determined.
    file_type: String,
}

/// Converts a Unix timestamp into a human-readable date and time.
///
/// # Arguments
///
/// * `timestamp` - A Unix timestamp representing the number of seconds
///   since January 1, 1970 UTC.
///
/// # Returns
///
/// A formatted date and time in the `YYYY-MM-DD HH:MM:SS` format.
/// Returns `"Unknown"` if the timestamp cannot be converted into a valid
/// local date and time.
fn format_date(timestamp: i64) -> String {
    match Local.timestamp_opt(timestamp, 0).single() {
        Some(date) => date.format("%Y-%m-%d %H:%M:%S").to_string(),
        None => "Unknown".to_string(),
    }
}

/// Converts a file size from bytes into a human-readable representation.
///
/// The function automatically selects an appropriate unit from bytes
/// through terabytes.
///
/// # Arguments
///
/// * `bytes` - The size of the file in bytes.
///
/// # Returns
///
/// A formatted string containing the size rounded to two decimal places
/// followed by its unit.
///
/// # Examples
///
/// ```
/// assert_eq!(format_size(1024), "1.00 KB");
/// assert_eq!(format_size(1048576), "1.00 MB");
/// assert_eq!(format_size(500), "500.00 B");
/// ```
fn format_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];

    let mut size = bytes as f64;
    let mut unit = 0;

    while size >= 1024.0 && unit < UNITS.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }

    return format!("{:.2} {}", size, UNITS[unit]);
}

/// Authenticates the user with the cloud storage service.
///
/// If the user is already logged in, the existing authentication token
/// is displayed in a partially masked form. Otherwise, the user is
/// prompted for their username and password.
///
/// Upon successful authentication, the returned token is stored in the
/// local configuration file.
///
/// # Errors
///
/// Authentication or configuration errors are displayed to the user
/// and the function returns without modifying the configuration when
/// an error occurs.
///
/// # Examples
///
/// ```text
/// $ ghost login
/// Please enter username: ross
/// Please enter password:
/// Logged in successfully.
/// ```
pub fn login() {
    let mut config = config::load_config();

    if config.token.is_some() {
        println!(
            Colour::Green,
            "You are already logged in ****{}",
            &config.token.as_ref().unwrap()[config.token.as_ref().unwrap().len() - 5..]
        );

        return;
    }

    print!(Colour::Green, "Please enter username: ");

    io::stdout().flush().unwrap();

    let mut username = String::new();

    io::stdin().read_line(&mut username).unwrap();

    let username = username.trim();

    print!(Colour::Green, "Please enter password: ");

    io::stdout().flush().unwrap();

    let password = read_password().unwrap();

    let client = reqwest::blocking::Client::new();

    let response = client
        .post("https://cloud.0h.co.za/api/login")
        .json(&serde_json::json!({
            "username": username,
            "password": password
        }))
        .send()
        .unwrap();

    if !response.status().is_success() {
        let body = response.text().unwrap_or_default();

        println!(Colour::Red, "{}", body);

        return;
    }

    let response = match response.json::<Value>() {
        Ok(response) => response,
        Err(e) => {
            println!(Colour::Red, "Failed to read response: {}", e);
            return;
        }
    };

    let token = response
        .get("token")
        .and_then(Value::as_str)
        .unwrap_or_default();

    config.token = Some(token.to_string());

    if let Err(e) = config::save_config(&config) {
        println!(Colour::Red, "Failed to save config: {}", e);
        return;
    }

    println!(Colour::Green, "Logged in successfully.");
}

/// Retrieves and displays the files and directories in the current directory.
///
/// The function loads the user's authentication token and current directory
/// from the local configuration, then sends an authenticated request to the
/// cloud storage API.
///
/// The results are displayed in a formatted table containing the entry type,
/// size, name, and last modification date.
///
/// # Permissions
///
/// The user must be logged in before this function can retrieve files.
///
/// # Errors
///
/// Request, authentication, HTTP, and JSON parsing errors are displayed
/// to the user and cause the function to return early.
///
/// # Examples
///
/// ```text
/// $ ghost ls
/// Your uploaded files:
/// Type       Size       Name
/// folder     0.00 B     Documents
/// pdf        2.35 MB    assignment.pdf
/// ```
pub fn list_entries() {
    let config = config::load_config();

    if config.token.is_none() {
        println!(Colour::Red, "You are not logged in. Please log in first.");

        return;
    }

    let token = config.token.as_ref().unwrap();
    let dir = &config.current_dir;

    let response = match reqwest::blocking::Client::new()
        .get(&format!("https://cloud.0h.co.za/api/uploads{}", dir))
        .bearer_auth(token)
        .send()
    {
        Ok(response) => response,
        Err(e) => {
            println!(Colour::Red, "Request failed: {}", e);
            return;
        }
    };

    if !response.status().is_success() {
        let status = response.status();

        println!(Colour::Red, "Request failed with status: {}", status);

        let body = response.text().unwrap_or_default();

        println!(Colour::Red, "{}", body);

        return;
    }

    let entries: Vec<Entry> = match response.json() {
        Ok(entries) => entries,
        Err(e) => {
            println!(Colour::Red, "Failed to parse response: {}", e);
            return;
        }
    };

    println!(Colour::Green, "Your uploaded files:");

    println!(
        Colour::Cyan,
        "{:<10} {:<10} {:<90} {}", "Type", "Size", "Name", "Date Modified"
    );

    for entry in entries {
        let entry_type = if entry.is_dir {
            "folder"
        } else if entry.file_type.is_empty() {
            "file"
        } else {
            &entry.file_type
        };

        println!(
            Colour::Cyan,
            "{:<10} {:<10} {:<90} {}",
            entry_type,
            format_size(entry.size),
            entry.name,
            format_date(entry.date_modified)
        );
    }
}

/// Deletes a file or directory.
///
/// This function is currently a placeholder and does not perform any
/// deletion.
pub fn delete_entry() {}

/// Renames a file or directory.
///
/// This function is currently a placeholder and does not perform any
/// rename operation.
pub fn rename_entry() {}

/// Moves a file or directory to another location.
///
/// This function is currently a placeholder and does not perform any
/// move operation.
pub fn move_entry() {}

/// Copies a file or directory to another location.
///
/// This function is currently a placeholder and does not perform any
/// copy operation.
pub fn copy_entry() {}
