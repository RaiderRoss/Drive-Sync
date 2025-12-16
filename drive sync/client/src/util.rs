use core::fmt;
use std::{
    collections::{HashMap, VecDeque},
    fs::{self, OpenOptions},
    io::Write,
    sync::{Arc, atomic::{AtomicBool, Ordering}},
};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tokio::{sync::Mutex};

use crate::{
    config::CONFIG,
    connection::{edit_client_side, edit_server_side, fetch_logs, send_logs},
    write_to_changes,
};

pub static IS_ANALYSING_LOGS: Lazy<Arc<AtomicBool>> =
    Lazy::new(|| Arc::new(AtomicBool::new(false)));

pub static IN_MEMORY_EVENTS: Lazy<Arc<Mutex<Vec<notify::Event>>>> =
    Lazy::new(|| Arc::new(Mutex::new(Vec::new())));

#[derive(Clone, Serialize, Deserialize)]
pub struct Event {
    pub event_type: String,
    pub path: String,
    pub time: i64,
}

impl fmt::Display for Event {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Type : {} Path : \"{}\" Time : {} ",
            self.event_type, self.path, self.time
        )
    }
}

impl Event {
    fn print(&self) -> String {
        let path = &self.path;

        let event_type = self.event_type.replace("(Any)", "");

        return format!(
            "[[events]]\nevent_type = {:?}\npath = \"{}\"\ntime = {:?}\n",
            event_type, path, self.time
        );
    }
}

impl PartialEq for Event {
    fn eq(&self, other: &Self) -> bool {
        self.path == other.path && self.event_type == other.event_type && self.time == other.time
    }
}

#[derive(Serialize, Deserialize)]
pub struct Events {
    events: Vec<Event>,
}

pub async fn analyse_logs() {
    let req = reqwest::get("http://localhost:3000/health").await;
    if req.is_ok() {
        IS_ANALYSING_LOGS.store(true, Ordering::Relaxed);
        process_changes();
        clean_logs(false);
        process_logs().await;

        let _ = fs::write(&CONFIG.changes_path, "");

        let mut locked = IN_MEMORY_EVENTS.lock().await;
        for e in locked.drain(..) {
            write_to_changes( e);
        }

        clean_logs(true);
        IS_ANALYSING_LOGS.store(false, Ordering::Relaxed);
    }
}

pub fn process_changes() {
    let content = fs::read_to_string(&CONFIG.changes_path).unwrap_or_default();
    let events = toml::from_str(&content);

    if events.is_ok() {
        let events: Events = events.unwrap();
        let mut queue: VecDeque<Event> = VecDeque::new();
        let mut cleaned_queue: VecDeque<Event> = VecDeque::new();

        for event in events.events {
            queue.push_back(event);
        }

        let mut prev_event: Option<Event> = None;

        for event in queue {
            if prev_event.is_some() {
                // TODO on linux a remove event contains a single rename event (from) if there is no following to, it is a remove
                if event.event_type.contains("To") {
                    let prev = prev_event.clone().unwrap();
                    let new_event = Event {
                        event_type: "Rename".to_string(),
                        path: format!("{}$-${}", prev.path.to_string(), &event.path),
                        time: event.time,
                    };
                    cleaned_queue.push_back(new_event);
                }
            }

            if event.event_type.contains("Remove") || event.event_type.contains("Modify(Any)") {
                cleaned_queue.push_back(event.clone());
            }

            prev_event = Some(event);
        }

        let mut message = "".to_string();

        for event in cleaned_queue {
            message = format!("{}{}", message, event.print());
        }

        let mut file = OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&CONFIG.changes_path)
            .unwrap();
        let _ = file.write(message.as_bytes());
    }
}

pub fn clean_logs(is_logs: bool) {
    let path = if is_logs {
        &CONFIG.log_path
    } else {
        &CONFIG.changes_path
    };

    let events = toml::from_str(&fs::read_to_string(path).unwrap());

    if events.is_ok() {
        let _ = fs::write(path, "");

        let events: Events = events.unwrap();
        let events = events.events;
        let seen_events = events.clone();
        println!("All events:");
        for x in seen_events.clone() {
            println!("{}", x.print());
        }

        let events_map: HashMap<(String, String), Event> = events
            .into_iter()
            .filter_map(|x| {
                let mut copy = x.clone();
                // TODO if remove is a folder, remove all modifies that are in that folder

                // TODO small optomization : since we only care about look ahead can split from current position and search to the end

                // if remove is followed by modify ignore remove
                let is_remove = x.event_type == "Remove";

                let find_modify = if is_remove {
                    seen_events.iter().find(|y| {
                        (y.event_type == "Modify" || y.event_type == "Rename") && y.path == x.path
                    })
                } else {
                    None
                };

                let ignore_modify = find_modify.is_some() && find_modify.unwrap().time > x.time;

                //if a modify is followed by a remove, ignore the modify event
                let is_modify = x.event_type == "Modify" || x.event_type == "Rename";

                let find_remove = if is_modify {
                    seen_events.iter().find(|y| {
                        y.event_type == "Remove"
                            && (y.path == x.path || x.path.contains(&format!("{}/", &y.path)))
                    })
                } else {
                    None
                };

                let ignore_remove = find_remove.is_some() && find_remove.unwrap().time > x.time;

                if is_modify && x.event_type != "Rename" {
                    let rename_event = seen_events.iter().find(|y| {
                        let split: Vec<_> = y.path.split("$-$").collect();
                        let old_path = split[0].to_string();
                        let matches = y.event_type == "Rename"
                            && !x.path.contains("$-$")
                            && x.path.contains(&old_path);
                        if matches {
                            println!("Matched event: {:?}", y.path);
                        }
                        matches
                    });

                    if let Some(rename_event) = rename_event {
                        println!("Found!!");
                        let split: Vec<_> = rename_event.path.split("$-$").collect();
                        let old_path = split[0].to_string();
                        let new_path = split[1].to_string();
                        copy.path =
                            format!("{}$-${}", x.path, x.path.replace(&old_path, &new_path));
                        println!("new path:{}", copy.path)
                    }
                }

                if ignore_modify || ignore_remove {
                    None
                } else {
                    Some((
                        (copy.path.clone(), copy.event_type.clone()),
                        Event {
                            path: copy.path,
                            event_type: copy.event_type,
                            time: copy.time,
                        },
                    ))
                }
            })
            .collect();

        let mut file = OpenOptions::new()
            .write(true)
            .append(true)
            .open(path)
            .unwrap();

        let mut events: Vec<Event> = events_map.values().cloned().collect();
        events.sort_by_key(|x| x.time);
        for event in events {
            let _ = file.write(event.print().as_bytes());
        }
    }
}

pub async fn process_logs() {
    // Client events = local changes
    // Client logs = logs of previous changes

    let client_events = get_events(&CONFIG.changes_path);
    let client_logs = get_events(&CONFIG.log_path);
    let server_logs = fetch_logs().await;

    // TODO split server logs at position of last client log

    if server_logs.is_some() && client_events.is_some() {
        let t1 = tokio::spawn(check_client_logs(client_events.unwrap()));
        let t2 = tokio::spawn(check_server_logs(client_logs, server_logs.unwrap()));
        let _ = tokio::join!(t1, t2);
        return;
    }

    if server_logs.is_some() {
        let t2 = tokio::spawn(check_server_logs(client_logs, server_logs.unwrap()));
        let _ = t2.await;
        return;
    }

    if client_events.is_some() {
        let t1 = tokio::spawn(check_client_logs(client_events.unwrap()));
        let _ = t1.await;
    }
}

async fn check_server_logs(client_logs: Option<Events>, server_logs: Events) {
    if client_logs.is_some() {
        let client_logs = client_logs.unwrap();
        for s in server_logs.events {
            // If the client side logs doesn't contain an entry from the server, update files locally
            if !client_logs.events.contains(&s) {
                edit_client_side(s.event_type, s.path);
            }
        }
        return;
    }

    for s in server_logs.events {
        edit_client_side(s.event_type, s.path);
    }
}

async fn check_client_logs(client_events: Events) {
    let mut file = OpenOptions::new()
        .write(true)
        .append(true)
        .open(&CONFIG.log_path)
        .unwrap();

    let client_events = client_events;
    let events = client_events.events.clone();

    for c in events {
        edit_server_side(c.event_type.clone(), c.path.clone());
        let _ = file.write(c.print().as_bytes());
    }

    send_logs(client_events).await;
}

pub fn get_events(path: &str) -> Option<Events> {
    let events = toml::from_str(&fs::read_to_string(path).unwrap());
    if events.is_ok() {
        events.unwrap()
    } else {
        None
    }
}

pub async fn log_err<T: std::fmt::Debug>(err: T) {
    let _ = fs::write(&CONFIG.error_logs, format!("{:#?}", err));
}
