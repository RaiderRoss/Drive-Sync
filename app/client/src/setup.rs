use std::fs::File;
use std::io::Write;

use iced::{
    Theme,
    alignment::Horizontal,
    widget::{Row, button, column, text}
};
use rfd::FileDialog;
#[derive(Default)]
pub struct SetUp {
    storage_path: String,
    dark_mode: bool,
}

#[derive(Debug, Clone, Copy)]
pub enum Message {
    ToggleTheme,
    PickFolder,
}

impl SetUp {
    pub fn new() -> Self {
        Self {
            storage_path: "".to_string(),
            dark_mode: true,
        }
    }

    pub fn view(&self) -> iced::Element<'_, Message> {
        let toggle = button(text("Toggle Theme")).on_press(Message::ToggleTheme);

        let path = text(self.storage_path.clone());
        let pick_folder = button(text("Select Folder")).on_press(Message::PickFolder);

        let message = text("Please choose which directory should be synced");
        let top_row = Row::new().padding(20).spacing(10).push(toggle);

        column![top_row, message, path, pick_folder]
            .align_x(Horizontal::Center)
            .spacing(20)
            .into()
    }

    pub fn update(&mut self, message: Message) {
        match message {
            Message::ToggleTheme => self.dark_mode = !self.dark_mode,

            Message::PickFolder => {
                let folder = FileDialog::new().set_directory("/").pick_folder();
                if let Some(folder) = folder {
                    self.storage_path = folder.to_string_lossy().to_string();
                    let folder =
                        format!("C:/Users/{}/AppData/Roaming/Drive_Sync", whoami::username());
                    let file_path = format!("{}/config.toml", folder);
                    let file = File::create(file_path.clone());
                    let log_path = format!("{}/logs.toml", folder);
                    let changes_path = format!("{}/changes.toml", folder);
                    let _ = file.unwrap().write(
                        format!(
                            "storage_path=\"{}\"\nlog_path = \"{}\"\nchanges_path = \"{}\"",
                            self.storage_path.replace("\\", "/"),
                            log_path,
                            changes_path
                        )
                        .as_bytes(),
                    );
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

pub fn run_setup() -> iced::Result {
    let icon_bytes = include_bytes!("../logo.png");
    let icon = iced::window::icon::from_file_data(icon_bytes, None).unwrap();

    iced::application(SetUp::new, SetUp::update, SetUp::view)
        .title("Drive Sync")
        .window(iced::window::Settings {
            size: iced::Size::new(300.0, 300.0),
            resizable: false,
            position: iced::window::Position::Centered,
            icon: Some(icon),
            ..Default::default()
        })
        .run()
}