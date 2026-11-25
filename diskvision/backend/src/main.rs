use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, anyhow};
use axum::extract::{Path as UrlPath, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use rusqlite::{Connection, OptionalExtension, Statement, params};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS drives (
    id          INTEGER PRIMARY KEY,
    path        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    root_id     INTEGER,
    total_space INTEGER,
    free_space  INTEGER,
    file_count  INTEGER NOT NULL DEFAULT 0,
    dir_count   INTEGER NOT NULL DEFAULT 0,
    scanned_at  INTEGER
);
CREATE TABLE IF NOT EXISTS nodes (
    id          INTEGER PRIMARY KEY,
    drive_id    INTEGER NOT NULL,
    parent_id   INTEGER,
    name        TEXT NOT NULL,
    is_dir      INTEGER NOT NULL,
    size        INTEGER NOT NULL,
    modified    INTEGER,
    child_count INTEGER NOT NULL DEFAULT 0,
    first_child INTEGER
);
";

const SCHEMA_VERSION: i64 = 2;

const DRIVE_NODES: &str = "drive_id = ?1 AND id BETWEEN
    (SELECT root_id FROM drives WHERE id = ?1) AND
    (SELECT root_id + file_count + dir_count - 1 FROM drives WHERE id = ?1)";

fn open_db(path: &Path) -> anyhow::Result<Connection> {
    let conn = Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
    conn.busy_timeout(std::time::Duration::from_secs(30))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    Ok(conn)
}

fn init_db(path: &Path) -> anyhow::Result<()> {
    let conn = open_db(path)?;

    conn.pragma_update(None, "journal_mode", "WAL")?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version < SCHEMA_VERSION {
        conn.execute_batch("DROP TABLE IF EXISTS nodes;")?;
    }
    conn.execute_batch(SCHEMA)?;
    if version < SCHEMA_VERSION {
        conn.execute_batch(
            "UPDATE drives SET root_id = NULL, file_count = 0, dir_count = 0, scanned_at = NULL; VACUUM;",
        )?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    }
    let (rows, expected): (i64, i64) = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM nodes),
                (SELECT COALESCE(SUM(file_count + dir_count), 0) FROM drives WHERE root_id IS NOT NULL)",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if rows != expected {
        conn.execute(
            "DELETE FROM nodes WHERE NOT EXISTS (
                 SELECT 1 FROM drives d WHERE d.id = nodes.drive_id
                     AND nodes.id BETWEEN d.root_id AND d.root_id + d.file_count + d.dir_count - 1)",
            [],
        )?;
    }
    Ok(())
}

#[derive(Clone)]
struct AppState {
    db_path: Arc<PathBuf>,

    scans: Arc<Mutex<HashMap<i64, ScanStatus>>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum ScanPhase {
    Walking,
    Saving,
    Done,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
struct ScanStatus {
    phase: ScanPhase,

    entries: u64,

    bytes: u64,

    errors: u64,
    elapsed_ms: u64,
    error: Option<String>,
    #[serde(skip)]
    started: Instant,
}

impl ScanStatus {
    fn running(&self) -> bool {
        match self.phase {
            ScanPhase::Walking | ScanPhase::Saving => true,
            ScanPhase::Done | ScanPhase::Failed => false,
        }
    }
}

struct AppError(StatusCode, String);

impl AppError {
    fn not_found(what: &str) -> Self {
        AppError(StatusCode::NOT_FOUND, format!("{what} not found"))
    }
    fn bad_request(msg: impl Into<String>) -> Self {
        AppError(StatusCode::BAD_REQUEST, msg.into())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        match err.downcast::<AppError>() {
            Ok(app) => app,
            Err(err) => AppError(StatusCode::INTERNAL_SERVER_ERROR, format!("{err:#}")),
        }
    }
}

impl std::fmt::Debug for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.0, self.1)
    }
}
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.1)
    }
}
impl std::error::Error for AppError {}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

type ApiResult<T> = Result<Json<T>, AppError>;

async fn with_db<T, F>(state: &AppState, work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> anyhow::Result<T> + Send + 'static,
{
    let path = state.db_path.clone();
    tokio::task::spawn_blocking(move || work(&open_db(&path)?))
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(AppError::from)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let db_path = PathBuf::from("diskvision.db");
    let addr = "127.0.0.1:5002";
    init_db(&db_path)?;

    let state = AppState { db_path: Arc::new(db_path.clone()), scans: Arc::default() };

    let app = Router::new()
        .route("/disks", get(list_disks))
        .route("/drives", get(list_drives))
        .route("/drives/{id}", delete(delete_drive))
        .route("/drives/{id}/status", get(scan_status))
        .route("/drives/{id}/resolve", get(resolve_path))
        .route("/drives/{id}/search", get(search))
        .route("/scan", post(start_scan))
        .route("/nodes/{id}/tree", get(tree))
        .route("/nodes/{id}/path", get(node_path))

        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&addr).await.with_context(|| format!("binding {addr}"))?;
    println!("DiskVision backend on http://{addr} (database: {})", db_path.display());
    axum::serve(listener, app).await?;
    Ok(())
}

#[derive(Serialize)]
struct DiskInfo {
    path: String,
    name: String,
    label: String,
    file_system: String,
    total_space: u64,
    free_space: u64,
    removable: bool,

    drive_id: Option<i64>,
}

const SKIP_FILE_SYSTEMS: &[&str] = &["squashfs", "tmpfs", "devtmpfs", "overlay", "efivarfs", "ramfs", "autofs"];

async fn list_disks(State(state): State<AppState>) -> ApiResult<Vec<DiskInfo>> {
    let known: HashMap<String, i64> = with_db(&state, |conn| {
        let mut stmt = conn.prepare("SELECT path, id FROM drives")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    })
    .await?;

    let disks = tokio::task::spawn_blocking(sysinfo::Disks::new_with_refreshed_list)
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for disk in disks.list() {
        let fs = disk.file_system().to_string_lossy().to_string();
        if disk.total_space() == 0 || SKIP_FILE_SYSTEMS.contains(&fs.as_str()) {
            continue;
        }
        let mount = disk.mount_point();
        let path = canonical_string(mount);
        if !seen.insert(path.clone()) {
            continue;
        }
        out.push(DiskInfo {
            drive_id: known.get(&path).copied(),
            name: display_name(mount),
            label: disk.name().to_string_lossy().to_string(),
            path,
            file_system: fs,
            total_space: disk.total_space(),
            free_space: free_space(mount, disk.available_space()),
            removable: disk.is_removable(),
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Json(out))
}

#[derive(Serialize)]
struct DriveInfo {
    id: i64,
    path: String,
    name: String,

    root_id: Option<i64>,
    size: Option<i64>,
    total_space: Option<i64>,
    free_space: Option<i64>,
    file_count: i64,
    dir_count: i64,
    scanned_at: Option<String>,
    scan: Option<ScanStatus>,
}

const DRIVE_COLUMNS: &str = "d.id, d.path, d.name, d.root_id, n.size, d.total_space, d.free_space, \
     d.file_count, d.dir_count, d.scanned_at FROM drives d LEFT JOIN nodes n ON n.id = d.root_id";

fn drive_from_row(r: &rusqlite::Row) -> rusqlite::Result<DriveInfo> {
    Ok(DriveInfo {
        id: r.get(0)?,
        path: r.get(1)?,
        name: r.get(2)?,
        root_id: r.get(3)?,
        size: r.get(4)?,
        total_space: r.get(5)?,
        free_space: r.get(6)?,
        file_count: r.get(7)?,
        dir_count: r.get(8)?,
        scanned_at: r.get::<_, Option<i64>>(9)?.map(format_time),
        scan: None,
    })
}

fn with_status(state: &AppState, mut drives: Vec<DriveInfo>) -> Vec<DriveInfo> {
    let scans = state.scans.lock().unwrap();
    for drive in &mut drives {
        drive.scan = scans.get(&drive.id).map(snapshot);
    }
    drives
}

async fn list_drives(State(state): State<AppState>) -> ApiResult<Vec<DriveInfo>> {
    let drives = with_db(&state, |conn| {
        let mut stmt = conn.prepare(&format!("SELECT {DRIVE_COLUMNS} ORDER BY d.path"))?;
        let rows = stmt.query_map([], drive_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
    .await?;
    Ok(Json(with_status(&state, drives)))
}

async fn delete_drive(State(state): State<AppState>, UrlPath(id): UrlPath<i64>) -> Result<StatusCode, AppError> {
    if state.scans.lock().unwrap().get(&id).is_some_and(ScanStatus::running) {
        return Err(AppError(StatusCode::CONFLICT, "drive is being scanned".into()));
    }
    let removed = with_db(&state, move |conn| {
        conn.execute(&format!("DELETE FROM nodes WHERE {DRIVE_NODES}"), [id])?;
        Ok(conn.execute("DELETE FROM drives WHERE id = ?1", [id])?)
    })
    .await?;
    state.scans.lock().unwrap().remove(&id);
    if removed == 0 { Err(AppError::not_found("drive")) } else { Ok(StatusCode::NO_CONTENT) }
}

#[derive(Deserialize)]
struct ScanRequest {
    path: String,
}

async fn start_scan(State(state): State<AppState>, Json(req): Json<ScanRequest>) -> ApiResult<DriveInfo> {
    let root = std::fs::canonicalize(&req.path).map_err(|e| AppError::bad_request(format!("{}: {e}", req.path)))?;
    if !root.is_dir() {
        return Err(AppError::bad_request(format!("{} is not a folder", req.path)));
    }
    let path = canonical_string(&root);
    let name = display_name(&root);

    let drive = with_db(&state, move |conn| {
        conn.execute("INSERT INTO drives (path, name) VALUES (?1, ?2) ON CONFLICT(path) DO NOTHING", params![path, name])?;
        Ok(conn.query_row(&format!("SELECT {DRIVE_COLUMNS} WHERE d.path = ?1"), [&path], drive_from_row)?)
    })
    .await?;

    {
        let mut scans = state.scans.lock().unwrap();
        if scans.get(&drive.id).is_some_and(ScanStatus::running) {
            return Err(AppError(StatusCode::CONFLICT, "a scan of this drive is already running".into()));
        }
        scans.insert(
            drive.id,
            ScanStatus {
                phase: ScanPhase::Walking,
                entries: 0,
                bytes: 0,
                errors: 0,
                elapsed_ms: 0,
                error: None,
                started: Instant::now(),
            },
        );
    }

    let (db_path, scans, drive_id) = (state.db_path.clone(), state.scans.clone(), drive.id);
    std::thread::spawn(move || {
        let result = run_scan(&db_path, drive_id, &root, &scans);
        let stale = {
            let mut scans = scans.lock().unwrap();
            let status = scans.get_mut(&drive_id);
            match (result, status) {
                (Ok(stale), Some(status)) => {
                    status.elapsed_ms = status.started.elapsed().as_millis() as u64;
                    status.phase = ScanPhase::Done;
                    stale
                }
                (Ok(stale), None) => stale,
                (Err(err), status) => {
                    eprintln!("scan of {} failed: {err:#}", root.display());
                    if let Some(status) = status {
                        status.elapsed_ms = status.started.elapsed().as_millis() as u64;
                        status.phase = ScanPhase::Failed;
                        status.error = Some(format!("{err:#}"));
                    }
                    None
                }
            }
        };
        if let Some(range) = stale {
            if let Err(err) = remove_nodes(&db_path, drive_id, range) {
                eprintln!("removing the previous scan of {} failed: {err:#}", root.display());
            }
        }
    });

    Ok(Json(with_status(&state, vec![drive]).pop().unwrap()))
}

fn snapshot(status: &ScanStatus) -> ScanStatus {
    let mut s = status.clone();
    if s.running() {
        s.elapsed_ms = s.started.elapsed().as_millis() as u64;
    }
    s
}

async fn scan_status(State(state): State<AppState>, UrlPath(id): UrlPath<i64>) -> ApiResult<ScanStatus> {
    let scans = state.scans.lock().unwrap();
    scans.get(&id).map(|s| Json(snapshot(s))).ok_or_else(|| AppError::not_found("scan"))
}

#[derive(Debug, Default, Clone)]
struct Meta {
    ok: bool,
    size: u64,
    modified: Option<i64>,

    hard_link: Option<(u64, u64)>,
}

fn read_meta(meta: &std::fs::Metadata) -> Meta {
    Meta {
        ok: true,
        size: if meta.is_file() { meta.len() } else { 0 },
        modified: meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64),
        hard_link: hard_link_key(meta),
    }
}

#[cfg(unix)]
fn hard_link_key(meta: &std::fs::Metadata) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    (meta.is_file() && meta.nlink() > 1).then(|| (meta.dev(), meta.ino()))
}
#[cfg(not(unix))]
fn hard_link_key(_: &std::fs::Metadata) -> Option<(u64, u64)> {
    None
}

#[cfg(unix)]
fn device_of(meta: &std::fs::Metadata) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    Some(meta.dev())
}
#[cfg(not(unix))]
fn device_of(_: &std::fs::Metadata) -> Option<u64> {
    None
}

struct Entry {
    parent: u32,
    name: Box<str>,
    is_dir: bool,
    size: u64,
    modified: Option<i64>,
    child_count: u32,
}

const NO_PARENT: u32 = u32::MAX;

fn run_scan(
    db_path: &Path,
    drive_id: i64,
    root: &Path,
    scans: &Mutex<HashMap<i64, ScanStatus>>,
) -> anyhow::Result<Option<(i64, i64)>> {
    let root_meta = std::fs::metadata(root).with_context(|| format!("reading {}", root.display()))?;
    let root_dev = device_of(&root_meta);
    let started = Instant::now();

    let walker = jwalk::WalkDirGeneric::<((), Meta)>::new(root)
        .skip_hidden(false)
        .follow_links(false)
        .sort(false)
        .process_read_dir(move |_, _, _, children| {
            for child in children.iter_mut().flatten() {
                match child.metadata() {
                    Ok(meta) => {
                        if child.file_type.is_dir() && root_dev.is_some() && device_of(&meta) != root_dev {
                            child.read_children = None;
                        }
                        child.client_state = read_meta(&meta);
                    }
                    Err(_) => child.read_children = None,
                }
            }
        });

    let update = |entries: &[Entry], bytes: u64, errors: u64, phase: Option<ScanPhase>| {
        if let Some(s) = scans.lock().unwrap().get_mut(&drive_id) {
            s.entries = entries.len() as u64;
            s.bytes = bytes;
            s.errors = errors;
            if let Some(phase) = phase {
                s.phase = phase;
            }
        }
    };

    let mut entries: Vec<Entry> = Vec::new();
    let mut stack: Vec<u32> = Vec::new();
    let mut seen_links: HashSet<(u64, u64)> = HashSet::new();
    let (mut bytes, mut errors) = (0u64, 0u64);

    for item in walker {
        let entry = match item {
            Ok(entry) => entry,
            Err(_) => {
                errors += 1;
                continue;
            }
        };
        let depth = entry.depth;
        let meta = if depth == 0 { read_meta(&root_meta) } else { entry.client_state.clone() };
        if !meta.ok {
            errors += 1;
            continue;
        }
        stack.truncate(depth);

        if stack.len() != depth {
            continue;
        }

        let mut size = meta.size;
        if let Some(key) = meta.hard_link {
            if !seen_links.insert(key) {
                size = 0;
            }
        }
        bytes += size;

        let index = u32::try_from(entries.len()).map_err(|_| anyhow!("too many entries"))?;
        let parent = stack.last().copied().unwrap_or(NO_PARENT);
        let is_dir = entry.file_type.is_dir();
        let name = if depth == 0 { display_name(root) } else { entry.file_name.to_string_lossy().into_owned() };
        entries.push(Entry { parent, name: name.into(), is_dir, size, modified: meta.modified, child_count: 0 });
        if is_dir {
            stack.push(index);
        }
        if entries.len() % 20_000 == 0 {
            update(&entries, bytes, errors, None);
        }
    }
    if entries.is_empty() {
        return Err(anyhow!("nothing could be read under {}", root.display()));
    }
    update(&entries, bytes, errors, Some(ScanPhase::Saving));
    let walked = started.elapsed();

    for i in (1..entries.len()).rev() {
        let (parent, size) = (entries[i].parent as usize, entries[i].size);
        entries[parent].size += size;
        entries[parent].child_count += 1;
    }
    let dir_count = entries.iter().filter(|e| e.is_dir).count() as i64;
    let file_count = entries.len() as i64 - dir_count;
    let order = breadth_first_order(&entries);
    let mut position = vec![0u32; entries.len()];
    for (pos, &index) in order.iter().enumerate() {
        position[index as usize] = pos as u32;
    }

    let mut conn = open_db(db_path)?;
    conn.pragma_update(None, "cache_size", -262_144)?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    let tx = conn.transaction()?;
    let base: i64 = tx.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM nodes", [], |r| r.get(0))?;
    let stale: Option<(i64, i64)> = tx
        .query_row(
            "SELECT root_id, root_id + file_count + dir_count - 1 FROM drives WHERE id = ?1 AND root_id IS NOT NULL",
            [drive_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    {
        let mut insert = tx.prepare(
            "INSERT INTO nodes (id, drive_id, parent_id, name, is_dir, size, modified, child_count, first_child)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        let mut next_child = 1i64;
        for (pos, &index) in order.iter().enumerate() {
            let e = &entries[index as usize];
            let parent = (e.parent != NO_PARENT).then(|| base + position[e.parent as usize] as i64);
            let first_child = (e.child_count > 0).then(|| base + next_child);
            next_child += e.child_count as i64;
            insert.execute(params![
                base + pos as i64,
                drive_id,
                parent,
                &*e.name,
                e.is_dir,
                e.size as i64,
                e.modified,
                e.child_count,
                first_child
            ])?;
        }
    }

    let (total, free) = volume_space(root);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    tx.execute(
        "UPDATE drives SET root_id = ?2, total_space = ?3, free_space = ?4, file_count = ?5,
                dir_count = ?6, scanned_at = ?7 WHERE id = ?1",
        params![drive_id, base, total, free, file_count, dir_count, now],
    )?;
    tx.commit()?;
    conn.execute_batch("PRAGMA optimize;")?;
    update(&entries, bytes, errors, None);
    Ok(stale)
}

fn remove_nodes(db_path: &Path, drive_id: i64, (first, last): (i64, i64)) -> anyhow::Result<()> {
    let conn = open_db(db_path)?;
    conn.pragma_update(None, "cache_size", -262_144)?;
    conn.execute("DELETE FROM nodes WHERE drive_id = ?1 AND id BETWEEN ?2 AND ?3", params![drive_id, first, last])?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    Ok(())
}

#[cfg(unix)]
fn free_space(mount: &Path, fallback: u64) -> u64 {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c_path) = std::ffi::CString::new(mount.as_os_str().as_bytes()) else {
        return fallback;
    };
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c_path.as_ptr(), &mut st) } != 0 {
        return fallback;
    }
    (st.f_bfree as u64).saturating_mul(st.f_frsize as u64)
}
#[cfg(not(unix))]
fn free_space(_: &Path, fallback: u64) -> u64 {
    fallback
}

fn breadth_first_order(entries: &[Entry]) -> Vec<u32> {
    let mut offsets = vec![0u32; entries.len() + 1];
    for (i, e) in entries.iter().enumerate() {
        offsets[i + 1] = offsets[i] + e.child_count;
    }
    let mut fill = offsets.clone();
    let mut kids = vec![0u32; entries.len().saturating_sub(1)];
    for (i, e) in entries.iter().enumerate().skip(1) {
        let slot = &mut fill[e.parent as usize];
        kids[*slot as usize] = i as u32;
        *slot += 1;
    }
    for i in 0..entries.len() {
        let group = &mut kids[offsets[i] as usize..offsets[i + 1] as usize];
        group.sort_unstable_by(|&a, &b| {
            let (a, b) = (&entries[a as usize], &entries[b as usize]);
            b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name))
        });
    }
    let mut order = Vec::with_capacity(entries.len());
    order.push(0u32);
    let mut head = 0;
    while head < order.len() {
        let node = order[head] as usize;
        order.extend_from_slice(&kids[offsets[node] as usize..offsets[node + 1] as usize]);
        head += 1;
    }
    order
}

fn volume_space(path: &Path) -> (Option<i64>, Option<i64>) {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|d| path.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| (Some(d.total_space() as i64), Some(free_space(d.mount_point(), d.available_space()) as i64)))
        .unwrap_or((None, None))
}

#[derive(Serialize)]
struct TreeNode {
    id: i64,
    name: String,
    is_dir: bool,
    size: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    modified: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    child_count: Option<i64>,

    #[serde(skip)]
    first_child: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<TreeNode>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    more_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    more_size: Option<i64>,
}

const NODE_COLUMNS: &str = "id, name, is_dir, size, modified, child_count, first_child";

fn node_from_row(r: &rusqlite::Row) -> rusqlite::Result<TreeNode> {
    let is_dir: bool = r.get(2)?;
    Ok(TreeNode {
        id: r.get(0)?,
        name: r.get(1)?,
        is_dir,
        size: r.get(3)?,
        modified: r.get::<_, Option<i64>>(4)?.map(format_time),
        child_count: if is_dir { Some(r.get(5)?) } else { None },
        first_child: r.get(6)?,
        children: None,
        more_count: None,
        more_size: None,
    })
}

const DEFAULT_CHILD_LIMITS: &[usize] = &[48, 8, 5, 4, 3, 2];
const MAX_DEPTH: usize = 12;

#[derive(Deserialize)]
struct TreeQuery {
    depth: Option<usize>,

    limits: Option<String>,
}

async fn tree(
    State(state): State<AppState>,
    UrlPath(id): UrlPath<i64>,
    Query(q): Query<TreeQuery>,
) -> ApiResult<TreeNode> {
    let depth = q.depth.unwrap_or(4).clamp(1, MAX_DEPTH);
    let limits: Vec<usize> = match q.limits.as_deref() {
        Some(text) => text
            .split(',')
            .map(|part| part.trim().parse::<usize>().map_err(|_| AppError::bad_request("limits must be numbers")))
            .collect::<Result<_, _>>()?,
        None => DEFAULT_CHILD_LIMITS.to_vec(),
    };
    if limits.is_empty() || limits.iter().any(|&n| n == 0 || n > 1000) {
        return Err(AppError::bad_request("limits must be between 1 and 1000"));
    }

    let node = with_db(&state, move |conn| {
        let mut root = conn
            .query_row(&format!("SELECT {NODE_COLUMNS} FROM nodes WHERE id = ?1"), [id], node_from_row)
            .optional()?
            .ok_or_else(|| AppError::not_found("node"))?;
        let mut children = conn
            .prepare_cached(&format!("SELECT {NODE_COLUMNS} FROM nodes WHERE id >= ?1 AND id < ?1 + ?2 ORDER BY id"))?;
        expand(&mut children, &mut root, 0, depth, &limits)?;
        Ok(root)
    })
    .await?;
    Ok(Json(node))
}

fn expand(
    children: &mut Statement,
    node: &mut TreeNode,
    depth: usize,
    max_depth: usize,
    limits: &[usize],
) -> anyhow::Result<()> {
    let (Some(total), Some(first)) = (node.child_count, node.first_child) else {
        return Ok(());
    };
    if depth >= max_depth {
        return Ok(());
    }
    let limit = (limits[depth.min(limits.len() - 1)] as i64).min(total);
    let mut kids = children.query_map(params![first, limit], node_from_row)?.collect::<Result<Vec<_>, _>>()?;

    let left_out = total - kids.len() as i64;
    if left_out > 0 {
        node.more_count = Some(left_out);
        node.more_size = Some(node.size - kids.iter().map(|k| k.size).sum::<i64>());
    }
    for kid in &mut kids {
        expand(children, kid, depth + 1, max_depth, limits)?;
    }
    node.children = Some(kids);
    Ok(())
}

fn path_to(conn: &Connection, id: i64) -> anyhow::Result<Vec<TreeNode>> {
    let mut stmt = conn.prepare_cached(&format!(
        "WITH RECURSIVE up(id, parent_id, level) AS (
             SELECT id, parent_id, 0 FROM nodes WHERE id = ?1
             UNION ALL
             SELECT n.id, n.parent_id, up.level + 1 FROM nodes n JOIN up ON n.id = up.parent_id
         )
         SELECT {NODE_COLUMNS} FROM nodes JOIN up USING (id) ORDER BY up.level DESC"
    ))?;
    let rows = stmt.query_map([id], node_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

async fn node_path(State(state): State<AppState>, UrlPath(id): UrlPath<i64>) -> ApiResult<Vec<TreeNode>> {
    let path = with_db(&state, move |conn| path_to(conn, id)).await?;
    if path.is_empty() { Err(AppError::not_found("node")) } else { Ok(Json(path)) }
}

#[derive(Deserialize)]
struct ResolveQuery {
    path: String,
}

async fn resolve_path(
    State(state): State<AppState>,
    UrlPath(drive): UrlPath<i64>,
    Query(q): Query<ResolveQuery>,
) -> ApiResult<Vec<TreeNode>> {
    let crumbs = with_db(&state, move |conn| {
        let (root_id, root_name): (Option<i64>, String) = conn
            .query_row("SELECT root_id, name FROM drives WHERE id = ?1", [drive], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?
            .ok_or_else(|| AppError::not_found("drive"))?;
        let root_id = root_id.ok_or_else(|| AppError::not_found("scan of this drive"))?;

        let text = q.path.trim().trim_matches(|c| c == '"' || c == '\'');
        let mut parts: Vec<&str> = text.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
        let root_parts: Vec<&str> = root_name.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
        if !root_parts.is_empty()
            && parts.len() >= root_parts.len()
            && parts.iter().zip(&root_parts).all(|(a, b)| a.eq_ignore_ascii_case(b))
        {
            parts.drain(..root_parts.len());
        }

        let mut find = conn.prepare_cached(
            "SELECT c.id FROM nodes p JOIN nodes c ON c.id >= p.first_child AND c.id < p.first_child + p.child_count
             WHERE p.id = ?1 AND c.name = ?2 COLLATE NOCASE ORDER BY c.name = ?2 DESC LIMIT 1",
        )?;
        let mut current = root_id;
        for part in parts {
            current = find
                .query_row(params![current, part], |r| r.get(0))
                .optional()?
                .ok_or_else(|| AppError::not_found(&format!("'{part}'")))?;
        }
        path_to(conn, current)
    })
    .await?;
    Ok(Json(crumbs))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    limit: Option<usize>,
}

#[derive(Serialize)]
struct SearchHit {
    #[serde(flatten)]
    node: TreeNode,

    path: String,
}

async fn search(
    State(state): State<AppState>,
    UrlPath(drive): UrlPath<i64>,
    Query(q): Query<SearchQuery>,
) -> ApiResult<Vec<SearchHit>> {
    let needle = q.q.trim().to_string();
    if needle.is_empty() {
        return Ok(Json(Vec::new()));
    }
    let limit = q.limit.unwrap_or(50).clamp(1, 500) as i64;
    let pattern = format!("%{}%", needle.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));

    let hits = with_db(&state, move |conn| {
        let mut stmt = conn.prepare(&format!(
            "SELECT {NODE_COLUMNS} FROM nodes WHERE {DRIVE_NODES} AND name LIKE ?2 ESCAPE '\\'
             ORDER BY size DESC LIMIT ?3"
        ))?;
        let nodes = stmt.query_map(params![drive, pattern, limit], node_from_row)?.collect::<Result<Vec<_>, _>>()?;
        nodes
            .into_iter()
            .map(|node| {
                let path = path_to(conn, node.id)?.into_iter().map(|c| c.name).collect::<Vec<_>>().join("/");
                Ok(SearchHit { node, path })
            })
            .collect()
    })
    .await?;
    Ok(Json(hits))
}

fn canonical_string(path: &Path) -> String {
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let text = path.to_string_lossy().to_string();
    text.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(text)
}

fn display_name(path: &Path) -> String {
    let text = canonical_string(path);
    let trimmed = text.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() { text } else { trimmed.to_string() }
}

fn format_time(secs: i64) -> String {
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));

    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02} {:02}:{:02}", rem / 3600, rem % 3600 / 60)
}
