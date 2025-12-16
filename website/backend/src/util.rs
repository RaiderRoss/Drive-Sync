use std::path::{Path, PathBuf};

use crate::UPLOAD_DIR;

pub fn clean_path(dir_path : String) -> Option<PathBuf> {

    let mut target_dir = PathBuf::from(UPLOAD_DIR.get().unwrap());
    let mut clean_path = PathBuf::new();

    for component in Path::new(&dir_path).components() {
        match component {
            std::path::Component::Normal(part) => clean_path.push(part),
            _ => return None
        }
    }

    target_dir = target_dir.join(clean_path);

    if !target_dir.exists() || !target_dir.is_dir() {
        return None;
    }

        
    return Some(target_dir);
}
