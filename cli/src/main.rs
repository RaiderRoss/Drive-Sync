use std::{
    env,
    io::{self, Write},
};

pub mod colour;
pub mod config;
pub mod login_handler;

use chrono::{Local, TimeZone};
use login_handler::read_password;
use serde_json::Value;

use colour::Colour;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        println!(Colour::Red, "Error: no command provided.");
        println!(Colour::Cyan, "Usage: ghost <command>");
        println!(Colour::Gray, "Try 'ghost help' an overview of ghost.");
        println!(
            Colour::Gray,
            "Try 'ghost <command> help' for more information on a specific command."
        );
        println!(
            Colour::Gray,
            "Try 'ghost commands' to list all available commands."
        );
        return;
    }

    for arg in &args[1..] {
        println!(Colour::White, "{}", arg);
    }

    match args[1].as_str() {
        "commands" => {
            println!(Colour::Green, "Available commands:");
            println!(Colour::Cyan, "help - Show help information.");
            println!(Colour::Cyan, "commands - List all available commands.");
            println!(Colour::Cyan, "login - Log in to the system.");
            println!(Colour::Cyan, "logout - Log out of the system.");
            println!(Colour::Cyan, "ls - List files and directories.");
            println!(Colour::Cyan, "rm - Delete a file or directory.");
            println!(Colour::Cyan, "cd - Change the current directory.");
            println!(Colour::Cyan, "pwd - Print the current directory.");
            println!(Colour::Cyan, "rename - Rename a file or directory.");
            println!(Colour::Cyan, "mv - Move a file or directory.");
            println!(Colour::Cyan, "cp - Copy a file or directory.");
        }

        "help" | "?" | "h" => {
            println!(Colour::Green, "Usage: ghost <message>");
            println!(Colour::Green, "Prints the provided message in red colour.");
        }

        "login" => {
            login();
        }

        "logout" => {
            let mut config = config::load_config();
            config.token = None;
            config.current_dir = "".to_string();
            if let Err(e) = config::save_config(&config) {
                println!(Colour::Red, "Failed to save config: {}", e);
            } else {
                println!(Colour::Green, "Logged out successfully.");
            }
        }

        "ls" => {
            list_entries();
        }

        "rm" => {
            delete_entry();
        }

        "cd" => {
            if args.len() < 3 {
                println!(Colour::Red, "Error: no directory provided.");
                return;
            }

            if args.len() > 3 {
                println!(Colour::Red, "Error: too many arguments provided.");
                return;
            }

            let dir = &args[2];
            let mut config = config::load_config();
            if dir == ".." {
                let current_dir = &config.current_dir;
                if current_dir != "" && !current_dir.is_empty() {
                    if let Some(pos) = current_dir.rfind('/') {
                        config.current_dir = current_dir[..pos].to_string();
                    } else {
                        config.current_dir = "".to_string();
                    }
                }
            } else {
                config.current_dir = format!("{}/{}", config.current_dir, dir);
            }

            if let Err(e) = save_config(&config) {
                println!(Colour::Red, "Failed to save config: {}", e);
            }

            println!(Colour::Green, "Changed directory to: {}", config.current_dir);
        }

        "pwd" => {
            let config = config::load_config();
            println!(Colour::Green, "Current directory: {}", config.current_dir);
        }

        "rename" => {
            rename_entry();
        }

        "mv" => {
            move_entry();
        }

        "cp" => {
            copy_entry();
        }

        _ => {
            println!(Colour::Red, "Error: unknown command '{}'.", args[1]);
        }
    }
}

fn login() {
    let mut config = config::load_config();

    if config.token.is_some() {
        println!(
            Colour::Green,
            "You are already logged in {}****{}",
            &config.token.as_ref().unwrap()[..3],
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

use serde::Deserialize;

use crate::config::save_config;

#[derive(Deserialize)]
struct Entry {
    name: String,
    size: u64,
    is_dir: bool,
    date_modified: i64,
    file_type: String,
}

fn format_date(timestamp: i64) -> String {
    match Local.timestamp_opt(timestamp, 0).single() {
        Some(date) => date.format("%Y-%m-%d %H:%M:%S").to_string(),
        None => "Unknown".to_string(),
    }
}

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

fn list_entries() {
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

fn delete_entry() {}

fn rename_entry() {}

fn move_entry() {}

fn copy_entry() {}
