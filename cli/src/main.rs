use crate::{config::save_config, util::{copy_entry, delete_entry, list_entries, login, move_entry, rename_entry}};
use std::env;


pub mod colour;
pub mod config;
pub mod login_handler;
pub mod util;


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
