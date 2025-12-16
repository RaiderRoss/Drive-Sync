// #![windows_subsystem = "windows"]

use iced::{
    Size,
    window::{self, Position},
};
use notify::{
    Event, EventKind, RecursiveMode, Result, Watcher,
    event::{AccessKind, CreateKind, ModifyKind},
};
use tokio::time::sleep;
use tungstenite::{WebSocket, stream::MaybeTlsStream};

use std::{
    fs::OpenOptions,
    io::Write,
    net::TcpStream,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{Ordering},
        mpsc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub mod config;
pub mod connection;
pub mod setup;
pub mod ui;
pub mod util;

use crate::{
    config::CONFIG,
    ui::Counter,
    util::{IN_MEMORY_EVENTS, IS_ANALYSING_LOGS, analyse_logs},
};


async fn watch() -> Result<()> {
    let (tx, rx) = mpsc::channel::<Result<Event>>();
    let mut watcher = notify::recommended_watcher(tx)?;
    watcher.watch(Path::new(&CONFIG.storage_path), RecursiveMode::Recursive)?;

    for res in rx {
        match res {
            Ok(event) => {
                if !(matches!(event.kind, EventKind::Modify(ModifyKind::Any))
                    && event.paths[0].is_dir())
                    && !(matches!(event.kind, EventKind::Create(CreateKind::Any)))
                    && !(matches!(event.kind, EventKind::Access(AccessKind::Open(_)))
                        || matches!(event.kind, EventKind::Access(AccessKind::Close(_))))
                {
                    if IS_ANALYSING_LOGS.load(Ordering::Relaxed) {
                       let mut events =  IN_MEMORY_EVENTS.lock().await;
                       events.push(event);
                    } else {
                        write_to_changes(event);
                    }
                }
            }
            Err(e) => println!("watch error: {:?}", e),
        }
    }

    Ok(())
}

fn run_ui(socket: Arc<Mutex<Option<WebSocket<MaybeTlsStream<TcpStream>>>>>) {
    let icon_bytes = include_bytes!("../logo.png");
    let icon = window::icon::from_file_data(icon_bytes, None).unwrap();

    let _ = iced::application("Drive Sync", Counter::update, Counter::view)
        .theme(|c: &Counter| c.current_theme())
        .window(window::Settings {
            position: Position::Centered,
            resizable: false,
            size: Size::new(300.0, 400.0),
            icon: Some(icon),
            ..Default::default()
        })
        .run_with(move || (Counter::new(socket.clone()), iced::Task::none()));
}

fn write_to_changes(event: Event) {
    println!("Writing change:{:?}", event.kind);
    let path = &event.paths[0];
    let mut file = OpenOptions::new()
        .append(true)
        .open(&CONFIG.changes_path)
        .unwrap();

    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();

    let mut path = path.display().to_string();

    path = path.replace("\\", "/");

    let storage = CONFIG.storage_path.replace("\\", "/");
    path = path
        .strip_prefix(&format!("{}/", storage))
        .unwrap_or(&path)
        .to_string();

    path = path.trim_start_matches('/').to_string();

    let changes = format!(
        "[[events]]\nevent_type = \"{:?}\"\npath = \"{}\"\ntime = {:?}\n",
        event.kind, path, time,
    );

    let _ = file.write(changes.as_bytes());
}

#[tokio::main]
async fn main() {
    let t2 = tokio::spawn(watch());
    let t1 = tokio::spawn(async {
        loop {
            if !IS_ANALYSING_LOGS.load(Ordering::Relaxed) {
                analyse_logs().await;
                sleep(Duration::from_secs(100)).await;
            }
            sleep(Duration::from_secs(10)).await;
        }
    });

    // let socket = create_socket();
    // let sock_clone = socket.clone();
    // connect_to_ws(sock_clone);

    // run_ui(socket);

    let _ = tokio::join!(t1, t2);
}
