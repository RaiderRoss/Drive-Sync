use iced::{
    Length, Theme,
    alignment::Horizontal,
    widget::{Row, button, column, progress_bar, text},
};
use std::{
    net::TcpStream,
    sync::{Arc, Mutex},
    thread,
};
use tungstenite::{Message as WSMessage, WebSocket, connect, stream::MaybeTlsStream};

use rfd::FileDialog;

#[derive(Default)]
pub struct Counter {
    status: bool,
    storage_path: String,
    dark_mode: bool,
    sync_progress: i64,
    socket: Arc<Mutex<Option<WebSocket<MaybeTlsStream<TcpStream>>>>>,
    button_text: String,
}

#[derive(Debug, Clone, Copy)]
pub enum Message {
    ToggleTheme,
    Connect,
    PickFolder,
}

impl Counter {
    pub fn new(sock: Arc<Mutex<Option<WebSocket<MaybeTlsStream<TcpStream>>>>>) -> Self {
        Self {
            socket: sock.clone(),
            button_text: if sock.lock().unwrap().is_some() {
                "Disconnect".to_string()
            } else {
                "Connect".to_string()
            },
            storage_path: "Folder".to_string(),
            status: sock.lock().unwrap().is_some(),
            ..Default::default()
        }
    }

    pub fn view(&self) -> iced::Element<'_, Message> {
        let toggle = button(text("Toggle Theme")).on_press(Message::ToggleTheme);
        let connect = button(text(&self.button_text))
            .on_press(Message::Connect)
            .style(if self.status {
                button::danger
            } else {
                button::success
            });

        let path = text(self.storage_path.clone());
        let prog = progress_bar(0.0..=50.0, self.sync_progress as f32).width(Length::Fixed(300.0));
        let pick_folder = button(text("Choose storage path")).on_press(Message::PickFolder);

        let top_row = Row::new()
            .padding(20)
            .spacing(10)
            .push(toggle)
            .push(connect);

        column![top_row, path, prog, pick_folder]
            .align_x(Horizontal::Center)
            .spacing(20)
            .into()
    }

    pub fn update(&mut self, message: Message) {
        match message {
            Message::ToggleTheme => self.dark_mode = !self.dark_mode,
            Message::Connect => {
                let mut sock_guard = self.socket.lock().unwrap();
                if self.button_text == "Disconnect" {
                    if let Some(mut sock) = sock_guard.take() {
                        let _ = sock.close(None);
                    }
                    self.status = false;
                    self.button_text = "Connect".to_string();
                } else if self.button_text == "Connect" && sock_guard.is_none() {
                    if let Ok((mut ws, _)) = connect("ws://localhost:3000/ws") {
                        let ws_stream = ws.get_mut();
                        if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = ws_stream {
                            tcp.set_nonblocking(true).ok();
                        }

                        *sock_guard = Some(ws);
                        self.status = true;
                        self.button_text = "Disconnect".to_string();

                        let sock_clone = self.socket.clone();
                        send(sock_clone);
                    }
                }
            }
            Message::PickFolder => {
                let folder = FileDialog::new().set_directory("/").pick_folder();
                if let Some(mut folder) = folder {
                    self.storage_path = folder.as_mut_os_string().clone().into_string().unwrap();
                }
            }
        }
    }

    pub fn current_theme(&self) -> Theme {
        if self.dark_mode {
            Theme::Nord
        } else {
            Theme::Light
        }
    }
}

fn send(sock_clone: Arc<Mutex<Option<WebSocket<MaybeTlsStream<TcpStream>>>>>) {
    thread::spawn(move || {
        let mut guard = sock_clone.lock().unwrap();
        if let Some(sock) = guard.as_mut() {
            sock.send(WSMessage::Text("Ping".into())).ok();
        }
    });
}