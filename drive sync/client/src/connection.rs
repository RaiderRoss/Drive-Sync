use std::{
    io::ErrorKind,
    net::TcpStream,
    sync::{Arc, Mutex, atomic::Ordering},
    thread::{self, sleep},
    time::Duration,
};

use reqwest::{Body, Client, get};
use serde_json::{from_str, json};
use tokio::fs;
use tungstenite::{WebSocket, connect, http::response, stream::MaybeTlsStream};

use crate::{
    config::CONFIG,
    util::{Events, IS_ANALYSING_LOGS, analyse_logs},
};

pub fn create_socket() -> Arc<Mutex<Option<WebSocket<MaybeTlsStream<TcpStream>>>>> {
    let socket: Arc<Mutex<Option<WebSocket<MaybeTlsStream<TcpStream>>>>> =
        Arc::new(Mutex::new(None));

    {
        let socket_clone = Arc::clone(&socket);
        thread::spawn(move || {
            loop {
                let mut guard = socket_clone.lock().unwrap();
                if let Some(sock) = guard.as_mut() {
                    match sock.read() {
                        Ok(msg) => match msg.to_text().unwrap() {
                            "update" => {
                                while IS_ANALYSING_LOGS.load(Ordering::Relaxed) {
                                    tokio::spawn(analyse_logs());
                                }
                            }
                            _ => (),
                        },
                        Err(tungstenite::Error::Io(e)) if e.kind() == ErrorKind::WouldBlock => {}
                        Err(_) => {}
                    }
                }
                drop(guard);
                sleep(Duration::from_millis(100));
            }
        });
    }

    socket
}

pub fn connect_to_ws(socket: Arc<Mutex<Option<WebSocket<MaybeTlsStream<TcpStream>>>>>) {
    tokio::task::spawn_blocking(move || {
        let mut guard = socket.lock().unwrap();
        let ws = connect("ws://localhost:3000/ws");
        if let Ok((mut ws, _)) = ws {
            let ws_stream = ws.get_mut();
            if let MaybeTlsStream::Plain(tcp) = ws_stream {
                tcp.set_nonblocking(true).ok();
            }
            *guard = Some(ws);
        }
    });
}

pub fn edit_server_side(event_type: String, path: String) {
    match event_type.as_str() {
        "Modify" => {
            tokio::spawn(send_file(path));
        }
        "Remove" => {
            tokio::spawn(send_delete_file(path));
        }
        "Rename" => {
            tokio::spawn(send_rename_file(path));
        }
        _ => (),
    }
}

async fn send_file(path: String) {
    println!("Path:{}", path);
    let mut client_name = path.to_string();

    if path.contains("$-$") {
        let split: Vec<_> = path.split("$-$").collect();
        client_name = split[1].to_string();
    }

    let file = tokio::fs::File::open(format!("{}/{}", &CONFIG.storage_path, client_name))
        .await
        .unwrap();

    let res = Client::new()
        .post(format!("http://localhost:3000/files/{}", path))
        .body(file_to_body(file))
        .send()
        .await;

    if res.is_err() {
        write_err_logs(
            None,
            Some(res.unwrap_err().status().unwrap().as_str()),
            "Sending file",
        )
        .await;
        return;
    }

    let status = res.unwrap().status();
    if status != 200 {
        write_err_logs(None, Some(status.as_str()), "Sending file").await;
    }
}

fn file_to_body(file: tokio::fs::File) -> Body {
    let stream = tokio_util::codec::FramedRead::new(file, tokio_util::codec::BytesCodec::new());
    let body = Body::wrap_stream(stream);
    body
}

async fn send_delete_file(path: String) {
    let res = Client::new()
        .delete(format!("http://localhost:3000/files/{}", path))
        .send()
        .await;

    if res.is_err() {
        write_err_logs(
            None,
            Some(res.unwrap_err().status().unwrap().as_str()),
            "Sending delete",
        )
        .await;
        return;
    }

    let status = res.unwrap().status();
    if status != 200 {
        write_err_logs(None, Some(status.as_str()), "Sending delete").await;
    }
}

async fn send_rename_file(path: String) {
    let split: Vec<_> = path.split("$-$").collect();
    let old = split[0].to_string();
    let new = split[1].to_string();
    let res = Client::new()
        .put("http://localhost:3000/files")
        .header("Content-Type", "application/json")
        .body(json!({"from": old, "to": new}).to_string())
        .send()
        .await;

    if res.is_err() {
        write_err_logs(
            None,
            Some(res.unwrap_err().status().unwrap().as_str()),
            "Sending rename",
        )
        .await;
        return;
    }

    let status = res.unwrap().status();
    if status != 200 {
        write_err_logs(None, Some(status.as_str()), "Sending rename").await;
    }
}

pub fn edit_client_side(event_type: String, path: String) {
    match event_type.as_str() {
        "Modify" => {
            tokio::spawn(get_file(path));
        }

        "Rename" => {
            tokio::spawn(rename_file(path));
        }

        "Remove" => {
            tokio::spawn(delete_file(path));
        }

        _ => (),
    }
}

async fn get_file(file_path: String) {
    let mut file_path = file_path;
    let mut server_name = file_path.to_string();
    if file_path.contains("$-$") {
        let parts: Vec<_> = file_path.split("$-$").collect();
        let old_name = format!("{}/{}", &CONFIG.storage_path.as_str(), parts[0]);
        let new_name = format!("{}/{}", &CONFIG.storage_path.as_str(), parts[1]);
        server_name = new_name.to_string();
        if tokio::fs::metadata(&new_name).await.is_ok() {
            file_path = parts[1].to_string();
        } else if tokio::fs::metadata(&old_name).await.is_ok() {
            file_path = parts[0].to_string();
        } else {
            file_path = parts[1].to_string();
        }
    }

    let req = get(format!("http://localhost:3000/files/{}", server_name))
        .await
        .unwrap();

    println!("Req status:{}", req.status());
    let body = req.bytes().await.unwrap();

    let path = format!("{}/{}", &CONFIG.storage_path, file_path);
    let dir = std::path::Path::new(&path).parent().unwrap();

    let create = tokio::fs::create_dir_all(dir).await;
    let write = tokio::fs::write(&path, &body).await;
}

async fn delete_file(path: String) {
    let path = format!("{}{}", &CONFIG.storage_path, path);
    let metadata = tokio::fs::metadata(&path).await;
    if metadata.is_err() {
        return;
    }
    let metadata = metadata.unwrap();
    if metadata.is_dir() {
        let res = fs::remove_dir(&path).await;
        if res.is_err() {
            write_err_logs(Some(&path), None, "Deleting folder").await;
        }
    } else {
        let res = fs::remove_file(&path).await;
        if res.is_err() {
            write_err_logs(Some(&path), None, "Deleting file").await;
        }
    }
}

async fn rename_file(path: String) {
    let split: Vec<_> = path.split("$-$").collect();
    let old = split[0].to_string();
    let new = split[1].to_string();
    let old = format!("{}{}", &CONFIG.storage_path, old);
    let new = format!("{}{}", &CONFIG.storage_path, new);
    let res = fs::rename(&old, &new).await;
    if res.is_err() {
        write_err_logs(Some(format!("{},{}", new, old).as_str()), None, "Renaming").await;
    }
}

pub async fn fetch_logs() -> Option<Events> {
    let res = get("http://localhost:3000/logs").await;

    if res.is_err() {
        write_err_logs(
            None,
            Some(res.unwrap_err().status().unwrap().as_str()),
            "Sending logs",
        )
        .await;
        return None;
    }
    let unwrapped = res.unwrap();

    let status = unwrapped.status();
    if status != 200 || status != 204 {
        write_err_logs(None, Some(status.as_str()), "Sending logs").await;
        return None;
    }

    if status == 204 {
        None
    } else {
        let res = unwrapped;
        let body = res.text().await.unwrap();
        from_str(&body).unwrap()
    }
}

pub async fn send_logs(events: Events) {
    println!("Sending");

    let client = Client::new();
    let res = client
        .post("http://localhost:3000/logs")
        .json(&events)
        .send()
        .await;

    if res.is_err() {
        write_err_logs(
            None,
            Some(res.unwrap_err().status().unwrap().as_str()),
            "Sending logs",
        )
        .await;
        return;
    }

    let status = res.unwrap().status();
    if status != 200 {
        write_err_logs(None, Some(status.as_str()), "Sending logs").await;
    }
}

async fn write_err_logs(path: Option<&str>, response: Option<&str>, event: &str) {
    let response = if response.is_some() {
        let response = response.unwrap();
        format!("|response:{}", response)
    } else {
        "".to_string()
    };

    let path = if path.is_some() {
        let path = path.unwrap();
        format!("|path:{}", path)
    } else {
        "".to_string()
    };

    let _ = fs::write(
        &CONFIG.error_logs,
        format!("event:{}{}{}", event, response, path),
    )
    .await;
}
