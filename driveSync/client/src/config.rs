use std::{
    fs::{self, File},
    io::Write,
};

use serde::Deserialize;

use crate::setup;

use once_cell::sync::Lazy;

pub static CONFIG: Lazy<Config> = Lazy::new(|| load_config());

#[derive(Deserialize)]
pub struct Config {
    pub storage_path: String,
    pub log_path: String,
    pub changes_path: String,
    pub error_logs: String,
}

pub fn load_config() -> Config {

    // let folder = format!("C:/Users/{}/AppData/Roaming/Drive_Sync", whoami::username());
    // let file_path = format!("{}/config.toml", folder);
    // let res = fs::read_to_string(file_path.clone());

    // if res.is_err() {

    //     fs::create_dir_all(&folder).unwrap();
    //     let file = File::create(file_path.clone());
    //     let log_path = format!("{}/logs.toml", folder);
    //     let changes_path = format!("{}/changes.toml", folder);
    //     let _ = file.unwrap().write(
    //         format!(
    //             "storage_path=\"\"\nlog_path = \"{}\"\nchanges_path = \"{}\"",
    //             log_path, changes_path
    //         )
    //         .as_bytes(),
    //     );
    //     let _ = File::create(log_path);
    //     let _ = File::create(changes_path);
    // }

    //let res = fs::read_to_string(file_path.clone());
    let res = fs::read_to_string("config.toml");
    let config: Config = toml::from_str(&res.unwrap().clone()).unwrap();

    // let path = config.storage_path.clone();

    // if path == "" {
    //     setup::run_setup();
    //     let res = fs::read_to_string(file_path);
    //     let config: Config = toml::from_str(&res.unwrap()).unwrap();
    //     return config;
    // }

    config
}
