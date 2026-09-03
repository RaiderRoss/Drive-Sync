//! # Admin Routes Module
//!
//! Defines and organizes HTTP route handlers for administrator-specific
//! operations.
//!
//! ## Structure
//! - `get.rs` — GET handlers for retrieving users and shared-file information.
//! - `delete.rs` — DELETE handlers for removing users and other administrative
//!   resources.
//!
//! ## Usage
//!
//! The handlers in this module are intended for administrator-only operations
//! and are protected by the appropriate administrator authentication middleware.

pub mod get;
pub mod delete;