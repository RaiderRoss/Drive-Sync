use axum::{
    Extension, Router, extract::{DefaultBodyLimit, ws::{Message, WebSocket, WebSocketUpgrade}}, http::StatusCode, response::Response, routing::{delete, get, post, put}
};
use futures_util::{SinkExt, StreamExt};
use std::{
    collections::HashMap,
    sync::{Arc, atomic::AtomicBool},
};
use tokio::{
    net::TcpListener,
    sync::{RwLock, mpsc},
};

use crate::route_handlers::{delete_file, get_file, get_logs, post_file, post_logs, rename_file};

pub mod route_handlers;
pub mod util;

pub type Clients = Arc<RwLock<HashMap<i32, mpsc::UnboundedSender<Message>>>>;

pub async fn handle_ws(ws: WebSocketUpgrade, clients: Clients) -> Response {
    ws.on_upgrade(|socket| client_loop(socket, clients))
}

async fn client_loop(socket: WebSocket, clients: Clients) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (sender, mut receiver) = mpsc::unbounded_channel::<Message>();

    let client_id = (rand::random::<u32>() as i32).abs();
    clients.write().await.insert(client_id, sender.clone());
    println!("Adding client: {}", client_id);

    tokio::spawn(async move {
        while let Some(msg) = receiver.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(Message::Text(text))) = ws_receiver.next().await {
        println!("{}", text);
        broadcast_clients(&clients, client_id).await;
    }

    clients
        .write()
        .await
        .retain(|_id, client_tx| !client_tx.same_channel(&sender));
    println!("Client disconnected");
}

async fn broadcast_clients(clients: &Clients, id: i32) {
    let clients_guard = clients.read().await;

    let msg = Message::Text("Updated".into());

    for (client_id, client_tx) in clients_guard.iter() {
        if *client_id != id {
            let _ = client_tx.send(msg.clone());
        }
    }
}

#[tokio::main]
async fn main() {
    let clients: Clients = Arc::new(RwLock::new(HashMap::new()));
    let is_running = Arc::new(AtomicBool::new(false));
    let copy = is_running.clone();
    let path = "logs.toml";
    let app = Router::new()
        .route(
            "/ws",
            get({
                let clients = clients.clone();
                move |ws: WebSocketUpgrade| handle_ws(ws, clients)
            }),
        )
        .layer(Extension(clients))
        .route("/health", get(StatusCode::OK))
        .route("/logs", post(move |value| post_logs(is_running, value)))
        .route("/logs", get(move || get_logs(path, copy)))
        .route("/files/{*path}", get(get_file))
        .route("/files/{*path}", post(post_file).layer(DefaultBodyLimit::max(50 * 1024 * 1014)))
        .route("/files/{*path}", delete(delete_file))
        .route("/files", put(rename_file));
    
    let listener = TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind port");

    println!("Listening on 127.0.0.1:3000");
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();
}
