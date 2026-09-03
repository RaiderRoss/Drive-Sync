//! Password reading utility for the application.
//! 
//! This module provides functionality to securely read passwords from the terminal without echoing them back to the screen.
//! It supports both Unix-like and Windows operating systems.
use std::io;

#[cfg(unix)]
use std::process::Command;

#[cfg(windows)]
use std::ffi::c_void;

/// Windows API functions for console mode manipulation.
#[cfg(windows)]
extern "system" {
    fn GetConsoleMode(
        hConsoleHandle: *mut c_void,
        lpMode: *mut u32,
    ) -> i32;

    fn SetConsoleMode(
        hConsoleHandle: *mut c_void,
        dwMode: u32,
    ) -> i32;

    fn GetStdHandle(nStdHandle: u32) -> *mut c_void;
}

#[cfg(windows)]
const STD_INPUT_HANDLE: u32 = -10i32 as u32;

#[cfg(windows)]
const ENABLE_ECHO_INPUT: u32 = 0x0004;

/// Reads a password from the terminal without echoing it back to the screen.
///
/// # Returns
/// An [`io::Result`] containing the password as a `String` if successful, or an error if the operation fails.
pub fn read_password() -> io::Result<String> {
    #[cfg(unix)]
    Command::new("stty")
        .arg("-echo")
        .status()?;

    #[cfg(windows)]
    unsafe {
        let handle = GetStdHandle(STD_INPUT_HANDLE);
        let mut mode = 0;

        if GetConsoleMode(handle, &mut mode) == 0 {
            return Err(io::Error::last_os_error());
        }

        if SetConsoleMode(handle, mode & !ENABLE_ECHO_INPUT) == 0 {
            return Err(io::Error::last_os_error());
        }
    }

    let mut password = String::new();
    let result = io::stdin().read_line(&mut password);

    // Restore terminal echo
    #[cfg(unix)]
    {
        let _ = Command::new("stty").arg("echo").status();
    }

    #[cfg(windows)]
    unsafe {
        let handle = GetStdHandle(STD_INPUT_HANDLE);
        let mut mode = 0;

        if GetConsoleMode(handle, &mut mode) != 0 {
            let _ = SetConsoleMode(handle, mode | ENABLE_ECHO_INPUT);
        }
    }

    println!();

    result.map(|_| password.trim_end().to_string())
}