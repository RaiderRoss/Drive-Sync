use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct Event {
    pub event_type: String,
    pub path: String,
    pub time: i64,
}

impl Event {
    pub fn print(&self) -> String {
        return format!(
            "[[events]]\nevent_type = {:?}\npath = \"{}\"\ntime = {:?}\n",
            self.event_type, self.path, self.time
        );
    }
}

#[derive(Serialize, Deserialize)]
pub struct Events {
    pub events: Vec<Event>,
}

pub fn get_events(path: &str) -> Option<Events> {
    let events = toml::from_str(&fs::read_to_string(path).unwrap());
    if events.is_ok() {
        Some(events.unwrap())
    } else {
        None
    }
}

pub fn clean_logs(logs: &str) {
    let events = toml::from_str(&fs::read_to_string(logs).unwrap());
    let mut file = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(logs)
        .unwrap();

    if events.is_ok() {
        let _ = file.write(b"");

        let events: Events = events.unwrap();
        let events = events.events;
        let seen_events = events.clone();

        let events_map: HashMap<(String, String), Event> = events
            .into_iter()
            .filter_map(|x| {
                let copy = x.clone();

                // TODO small optomization : since we only care about look ahead can split from current position and search to the end

                // if remove is followed by modify ignore remove
                let is_remove = x.event_type == "Remove";

                let find_modify = if is_remove {
                    seen_events.iter().find(|y| {
                        (y.event_type == "Modify" || y.event_type == "Rename")
                            && y.path == x.path.clone()
                    })
                } else {
                    None
                };

                let ignore_modify = find_modify.is_some() && find_modify.unwrap().time > x.time;

                //if a modify is followed by a remove, ignore the modify event
                let is_modify = x.event_type == "Modify" || x.event_type == "Rename";

                let find_remove = if is_modify {
                    seen_events
                        .iter()
                        .find(|y| is_modify && y.event_type == "Remove" && y.path == x.path.clone())
                } else {
                    None
                };

                let ignore_remove = find_remove.is_some() && find_remove.unwrap().time > x.time;

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

        let mut events: Vec<Event> = events_map.values().cloned().collect();
        events.sort_by_key(|x| x.time);
        for event in events {
            let _ = file.write(event.print().as_bytes());
        }
    }
}
