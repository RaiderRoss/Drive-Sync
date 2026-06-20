-- Add migration script here
CREATE TABLE shared_files (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);