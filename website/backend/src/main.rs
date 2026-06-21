use axum::{
    Router,
    http::Method,
    middleware,
    routing::{delete, get, post},
};

use sqlx::SqlitePool;

use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};

pub mod auth;
pub mod db;
pub mod routes;
pub mod util;

use auth::login;

use crate::{
    auth::{auth_middleware, get_auth, register_user},
    db::setup_db,
    routes::{
        delete::{delete_file, delete_share_link},
        get::{
            download_file, get_shared_file, list_shared_files, list_uploaded_files, stream_video,
        },
        post::{create_path, create_shared_path, rename_path, upload_file, upload_root},
    },
    util::{UPLOAD_DIR, initialize_config},
};

type AppState = Arc<Data>;

#[derive(Clone)]
pub struct Data {
    pub db: SqlitePool,
}

#[tokio::main]
async fn main() {
    initialize_config();

    let state: AppState = Arc::new(Data {
        db: SqlitePool::connect(&format!(
            "sqlite://{}/users.db?mode=rwc",
            UPLOAD_DIR.get().unwrap()
        ))
        .await
        .unwrap(),
    });

    let err = setup_db(&state.db).await;

    if let Err(_) = err {
        
    }

    let app = create_router(state);

    let listener = TcpListener::bind("0.0.0.0:5003").await.unwrap();

    axum::serve(listener, app).await.unwrap();
}

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any);

    let protected_routes = Router::new()
        .route("/upload/{*path}", post(upload_file))
        .route("/upload/", post(upload_root))
        .route("/uploads/{*path}", get(list_uploaded_files))
        .route("/uploads", get(list_uploaded_files))
        .route("/download/{*path}", get(download_file))
        .route("/stream/{*path}", get(stream_video))
        .route("/create_path/{*path}", post(create_path))
        .route("/delete/{*path}", delete(delete_file))
        .route("/rename", post(rename_path))
        .route("/share", post(create_shared_path))
        .route("/shares", get(list_shared_files))
        .route("/share/{*path}", delete(delete_share_link))
        .layer(middleware::from_fn(auth_middleware));

    Router::new()
        .route("/login", post(login))
        .route("/register", post(register_user))
        .route("/auth", get(get_auth))
        .route("/share/{*path}", get(get_shared_file))
        .merge(protected_routes)
        .layer(cors)
        .with_state(state)
        .layer(axum::extract::DefaultBodyLimit::disable())
}
