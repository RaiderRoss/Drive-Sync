use iced::{
    Border, Color, Length,
    alignment::{Horizontal, Vertical},
    widget::{button, column, container, progress_bar, row, text},
};
use iced_aw::Spinner;
use std::{net::TcpStream, sync::{Arc, Mutex}};
use tungstenite::{WebSocket, connect, stream::MaybeTlsStream};
use rfd::FileDialog;

// ── Palette ────────────────────────────────────────────────────────────────────

const SURFACE:  Color = Color { r: 0.094, g: 0.094, b: 0.110, a: 1.0 };
const SURFACE2: Color = Color { r: 0.133, g: 0.133, b: 0.157, a: 1.0 };
const BORDER:   Color = Color { r: 0.180, g: 0.180, b: 0.220, a: 1.0 };
const ACCENT:   Color = Color { r: 0.486, g: 0.416, b: 0.969, a: 1.0 };
const ACCENT_D: Color = Color { r: 0.290, g: 0.259, b: 0.510, a: 1.0 };
const TEXT:     Color = Color { r: 0.941, g: 0.933, b: 1.000, a: 1.0 };
const TEXT_DIM: Color = Color { r: 0.290, g: 0.282, b: 0.376, a: 1.0 };
const TEXT_SUB: Color = Color { r: 0.545, g: 0.537, b: 0.627, a: 1.0 };
const SUCCESS:  Color = Color { r: 0.239, g: 0.839, b: 0.549, a: 1.0 };
const DANGER:   Color = Color { r: 0.941, g: 0.420, b: 0.420, a: 1.0 };

fn surface_style() -> iced::widget::container::Style {
    iced::widget::container::Style {
        background: Some(SURFACE2.into()),
        border: Border { color: BORDER, width: 1.0, radius: 14.0.into() },
        ..Default::default()
    }
}

fn card<'a>(content: impl Into<iced::Element<'a, Message>>) -> iced::widget::Container<'a, Message> {
    container(content).padding(14).style(|_| surface_style())
}

fn vspace(n: f32) -> iced::Element<'static, Message> {
    iced::widget::Space::new().height(Length::Fixed(n)).into()
}

fn hfill() -> iced::widget::Space {
    iced::widget::Space::new().width(Length::Fill)
}

// ── State ──────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct Counter {
    status: bool,
    connecting: bool,
    storage_path: String,
    dark_mode: bool,
    sync_progress: f32,
    socket: Arc<Mutex<Option<WebSocket<MaybeTlsStream<TcpStream>>>>>,
}

#[derive(Debug, Clone, Copy)]
pub enum Message {
    ToggleTheme,
    Connect,
    PickFolder,
}

impl Counter {
    pub fn new(sock: Arc<Mutex<Option<WebSocket<MaybeTlsStream<TcpStream>>>>>) -> Self {
        let connected = sock.lock().unwrap().is_some();
        Self {
            socket: sock,
            status: connected,
            dark_mode: true,
            ..Default::default()
        }
    }

    pub fn view(&self) -> iced::Element<'_, Message> {
        let content = column![
            container(
                column![
                    self.connection_section(),
                    vspace(12.0),
                    self.folder_section(),
                    vspace(12.0),
                    self.progress_section(),
                    vspace(12.0),
                ]
            )
            .padding([0u16, 16]),
            self.footer(),
        ];

        container(content)
            .style(|_| iced::widget::container::Style {
                background: Some(SURFACE.into()),
                border: Border { color: BORDER, width: 1.0, radius: 20.0.into() },
                ..Default::default()
            })
            .width(Length::Fixed(300.0))
            .into()
    }

    fn section_label<'a>(label: &'a str) -> iced::Element<'a, Message> {
        text(label.to_uppercase())
            .size(9)
            .color(TEXT_DIM)
            .font(iced::Font { weight: iced::font::Weight::Medium, ..Default::default() })
            .into()
    }

    fn connection_section(&self) -> iced::Element<'_, Message> {
        let dot_color = if self.status { SUCCESS } else { DANGER };

        let status_str = if self.connecting {
            "Connecting…"
        } else if self.status {
            "Connected"
        } else {
            "Disconnected"
        };

        let dot = container(iced::widget::Space::new())
            .width(Length::Fixed(8.0))
            .height(Length::Fixed(8.0))
            .style(move |_| iced::widget::container::Style {
                background: Some(dot_color.into()),
                border: Border { radius: 4.0.into(), ..Default::default() },
                ..Default::default()
            });

        let status_col = column![
            text("STATUS").size(9).color(TEXT_DIM),
            text(status_str).size(13).color(TEXT),
        ]
        .spacing(2);

        let (btn_label, btn_color, btn_border) = if self.status {
            ("Disconnect", DANGER, Color { a: 0.5, ..DANGER })
        } else {
            ("Connect", SUCCESS, Color { a: 0.5, ..SUCCESS })
        };

        let connect_btn: iced::Element<'_, Message> = if self.connecting {
            row![Spinner::new(), text("Connecting").size(12).color(TEXT_SUB)]
                .spacing(6)
                .align_y(Vertical::Center)
                .into()
        } else {
            button(text(btn_label).size(12).color(btn_color))
                .on_press(Message::Connect)
                .padding([7u16, 14])
                .style(move |_, _| button::Style {
                    background: Some(Color { a: 0.08, ..btn_color }.into()),
                    border: Border { color: btn_border, width: 1.0, radius: 8.0.into() },
                    text_color: btn_color,
                    ..Default::default()
                })
                .into()
        };

        let inner = row![
            row![dot, status_col].spacing(10).align_y(Vertical::Center),
            hfill(),
            connect_btn,
        ]
        .align_y(Vertical::Center)
        .width(Length::Fill);

        column![
            Self::section_label("connection"),
            vspace(6.0),
            card(inner).width(Length::Fill),
        ]
        .spacing(0)
        .into()
    }

    fn folder_section(&self) -> iced::Element<'_, Message> {
        let path_display = if self.storage_path.is_empty() {
            "Choose a folder…"
        } else {
            &self.storage_path
        };
        let hint = if self.storage_path.is_empty() { "tap to select" } else { "tap to change" };

        let folder_icon = container(text("⊞").size(14).color(ACCENT))
            .width(Length::Fixed(36.0))
            .height(Length::Fixed(36.0))
            .align_x(Horizontal::Center)
            .align_y(Vertical::Center)
            .style(|_| iced::widget::container::Style {
                background: Some(Color { a: 0.12, ..ACCENT }.into()),
                border: Border { color: ACCENT_D, width: 1.0, radius: 10.0.into() },
                ..Default::default()
            });

        let text_col = column![
            text(path_display).size(12).color(TEXT),
            text(hint).size(11).color(TEXT_DIM),
        ]
        .spacing(2)
        .width(Length::Fill);

        let inner = row![folder_icon, text_col, text("›").size(14).color(TEXT_DIM)]
            .spacing(12)
            .align_y(Vertical::Center)
            .width(Length::Fill);

        let btn = button(inner)
            .on_press(Message::PickFolder)
            .padding(14u16)
            .width(Length::Fill)
            .style(|_, _| button::Style {
                background: Some(SURFACE2.into()),
                border: Border { color: BORDER, width: 1.0, radius: 14.0.into() },
                ..Default::default()
            });

        column![
            Self::section_label("storage path"),
            vspace(6.0),
            btn,
        ]
        .spacing(0)
        .into()
    }

    fn progress_section(&self) -> iced::Element<'_, Message> {
        let pct = format!("{:.0}%", self.sync_progress * 100.0);

        let header = row![
            text("FILES SYNCED").size(9).color(TEXT_DIM),
            hfill(),
            text(pct).size(11).color(ACCENT),
        ]
        .width(Length::Fill);

        let bar = container(
            progress_bar(0.0..=1.0, self.sync_progress)
                .style(|_| iced::widget::progress_bar::Style {
                    background: SURFACE2.into(),
                    bar: ACCENT.into(),
                    border: Border { radius: 2.0.into(), ..Default::default() },
                })
        )
        .height(Length::Fixed(4.0));

        column![
            Self::section_label("sync progress"),
            vspace(6.0),
            header,
            vspace(8.0),
            bar,
        ]
        .spacing(0)
        .into()
    }

    fn footer(&self) -> iced::Element<'_, Message> {
        let dot = container(iced::widget::Space::new())
            .width(Length::Fixed(5.0))
            .height(Length::Fixed(5.0))
            .style(|_| iced::widget::container::Style {
                background: Some(SUCCESS.into()),
                border: Border { radius: 3.0.into(), ..Default::default() },
                ..Default::default()
            });

        container(
            row![dot, text("v1.0.0 — idle").size(10).color(TEXT_DIM)]
                .spacing(6)
                .align_y(Vertical::Center)
        )
        .padding([10u16, 16])
        .width(Length::Fill)
        .style(|_| iced::widget::container::Style {
            border: Border { color: BORDER, width: 1.0, radius: 0.0.into() },
            ..Default::default()
        })
        .into()
    }

    pub fn update(&mut self, message: Message) {
        match message {
            Message::ToggleTheme => self.dark_mode = !self.dark_mode,

            Message::Connect => {
                let mut sock = self.socket.lock().unwrap();
                if self.status {
                    if let Some(mut ws) = sock.take() {
                        let _ = ws.close(None);
                    }
                    self.status = false;
                    return;
                }
                self.connecting = true;
                if let Ok((ws, _)) = connect("ws://localhost:3000/ws") {
                    *sock = Some(ws);
                    self.status = true;
                }
                self.connecting = false;
            }

            Message::PickFolder => {
                if let Some(folder) = FileDialog::new().pick_folder() {
                    self.storage_path = folder.to_string_lossy().to_string();
                }
            }
        }
    }

}