//! # Routes Module
//!
//! Defines and organizes the application's HTTP route handlers.
//!
//! ## Structure
//! - `get.rs` — GET handlers for retrieving files, shares, archives, and other resources.
//! - `delete.rs` — DELETE handlers for removing files and share links.
//! - `post.rs` — POST handlers for uploading, creating, and renaming files and directories.
//! - `auth.rs` — Authentication, authorization, JWT, login, and registration handlers.
//! - `sse.rs` — Server-Sent Events handlers for real-time server-to-client updates.
//!
//! ## Usage
//!
//! The individual route modules expose handlers that are wired into the
//! application's main router and protected by the appropriate authentication
//! or administrator middleware.

pub mod get;
pub mod delete;
pub mod post;
pub mod auth;
pub mod sse;
