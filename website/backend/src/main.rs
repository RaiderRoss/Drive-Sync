//! HTTP server entry point for the application's API.
//!
//! This module initializes the application state, configures the database and
//! event system, starts the Axum HTTP server, and defines all API routes.
//!
//! Routes are organized into public, authenticated, and administrator-only
//! groups. Authentication and authorization are enforced through Axum
//! middleware where required.
//!
//! Route groups include:
//! - `/login` → User login endpoint (public).
//! - `/register` → User registration endpoint (public).
//! - `/auth` → Retrieves the currently authenticated user's information.
//! - `/share/{path}` → Public access to a shared file.
//! - `/events` → Server-Sent Events endpoint.
//! - Storage routes → File upload, download, listing, deletion, renaming,
//!   sharing, archive browsing, and video streaming (authenticated).
//! - Management routes → User and share management (administrator-only).

use axum::{
    Json, Router,
    http::Method,
    middleware,
    routing::{delete, get, post},
};

use serde_json::Value;
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::{net::TcpListener, sync::broadcast};
use tower_http::cors::{Any, CorsLayer};
pub mod admin;
pub mod routes;
pub mod util;

use crate::{
    admin::{
        delete::remove_user,
        get::{get_users, list_users_shares},
    },
    routes::{
        auth::{admin_middleware, auth_middleware, get_auth, login, register_user},
        delete::{delete_file, delete_share_link},
        get::{
            download_file, get_shared_file, list_archive_entries, list_shared_files,
            list_uploaded_files, stream_video,
        },
        post::{create_path, create_shared_path, rename_path, upload_file, upload_root},
        sse::events_sse,
    },
    util::util::{UPLOAD_DIR, initialize_config, setup_db},
};

/// Defines the visibility scope of a server-sent event.
///
/// Events can either be visible to all connected clients, only to a specific
/// user, or only to administrator clients.
#[derive(Clone)]
pub enum EventScope {
    /// An event that is visible to all connected clients.
    Global,

    /// An event that is visible only to the specified user.
    User(String),

    /// An event that is visible only to administrator clients.
    Admin,
}

/// Represents an event sent through the application's broadcast channel.
///
/// Each event contains a scope determining which clients should receive it,
/// an event type identifying the kind of event, and JSON data containing the
/// event payload.
#[derive(Clone)]
pub struct ServerEvent {
    /// Determines which connected clients are allowed to receive the event.
    pub scope: EventScope,

    /// Identifies the type of event being sent.
    pub event_type: String,

    /// JSON payload containing the event data.
    pub data: Json<Value>,
}

/// Shared application state used by Axum route handlers.
type AppState = Arc<Data>;

/// Contains the shared state required by the application.
///
/// The state contains the SQLite database connection pool and the broadcast
/// channel used to distribute server-sent events between connected clients.
#[derive(Clone)]
pub struct Data {
    /// Connection pool used to access the application's SQLite database.
    pub db: SqlitePool,

    /// Broadcast channel used to distribute server events to subscribers.
    pub events: broadcast::Sender<ServerEvent>,
}

/// Starts the Axum HTTP server.
///
/// This function initializes the application configuration, creates the
/// server event broadcast channel, establishes the SQLite database
/// connection, initializes the database schema, constructs the application
/// router, and starts listening for incoming HTTP connections.
///
/// If database setup fails, the server startup is aborted.
///
/// # Panics
///
/// Panics if the upload directory configuration is unavailable, the SQLite
/// connection cannot be established, the TCP listener cannot bind to the
/// configured address, or the Axum server fails to start.
#[tokio::main]
async fn main() {
    initialize_config();

    let (events, _) = broadcast::channel(100);

    let state: AppState = Arc::new(Data {
        db: SqlitePool::connect(&format!(
            "sqlite://{}/users.db?mode=rwc",
            UPLOAD_DIR.get().unwrap()
        ))
        .await
        .unwrap(),
        events,
    });

    let err = setup_db(&state.db).await;

    if let Err(e) = err {
        eprintln!("Failed to set up database: {}", e);
        return;
    }

    let app = create_router(state);

    let listener = TcpListener::bind("0.0.0.0:5003").await.unwrap();

    axum::serve(listener, app).await.unwrap();
}

/// Builds the complete application router.
///
/// The returned router contains all public, authenticated, and
/// administrator-only HTTP endpoints. Authentication middleware is applied
/// to protected storage routes, while administrator middleware is applied
/// to management routes.
///
/// # Route Structure
///
/// Public routes:
/// - `/login` → User login.
/// - `/register` → User registration.
/// - `/auth` → Retrieve authentication information.
/// - `/share/{path}` → Retrieve a shared file.
/// - `/events` → Server-Sent Events connection.
///
/// Authenticated routes:
/// - `/upload/{path}` → Upload a file.
/// - `/upload/` → Upload to the user's root directory.
/// - `/uploads/{path}` → List uploaded files.
/// - `/uploads` → List uploaded files.
/// - `/download/{path}` → Download a file.
/// - `/archive/{path}` → List archive contents.
/// - `/stream/{path}` → Stream a video.
/// - `/create_path/{path}` → Create a directory or path.
/// - `/delete/{path}` → Delete a file or directory.
/// - `/rename` → Rename a file or directory.
/// - `/share` → Create a shared path.
/// - `/shares` → List the user's shared files.
/// - `/share/{path}` → Delete a share link.
///
/// Administrator-only routes:
/// - `/manage/list` → List users.
/// - `/manage/delete/{id}` → Delete a user.
/// - `/manage/files` → Retrieve user information for file management.
/// - `/manage/shares` → List users' shared files.
///
/// # Arguments
///
/// * `state` - Shared application state containing the database connection
///   pool and server event broadcast channel.
///
/// # Returns
///
/// Returns an Axum [`Router`] configured with all application routes,
/// middleware, CORS configuration, shared state, and the default body limit
/// disabled.
pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any);

    // Routes for storage operations, protected by authentication middleware

    let protected_routes = Router::new()
        .route("/upload/{*path}", post(upload_file))
        .route("/upload/", post(upload_root))
        .route("/uploads/{*path}", get(list_uploaded_files))
        .route("/uploads", get(list_uploaded_files))
        .route("/download/{*path}", get(download_file))
        .route("/archive/{*path}", get(list_archive_entries))
        .route("/stream/{*path}", get(stream_video))
        .route("/create_path/{*path}", post(create_path))
        .route("/delete/{*path}", delete(delete_file))
        .route("/rename", post(rename_path))
        .route("/share", post(create_shared_path))
        .route("/shares", get(list_shared_files))
        .route("/share/{*path}", delete(delete_share_link))
        .layer(middleware::from_fn(auth_middleware));

    let admin_routes = Router::new()
        .route("/manage/list", get(get_users))
        .route("/manage/delete/{*id}", delete(remove_user))
        .route("/manage/files", get(get_users))
        .route("/manage/shares", get(list_users_shares))
        .layer(middleware::from_fn(admin_middleware));

    Router::new()
        .route("/login", post(login))
        .route("/register", post(register_user))
        .route("/auth", get(get_auth))
        .route("/share/{*path}", get(get_shared_file))
        .route("/events", get(events_sse))
        .merge(protected_routes)
        .merge(admin_routes)
        .layer(cors)
        .with_state(state)
        .layer(axum::extract::DefaultBodyLimit::disable())
}
