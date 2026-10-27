#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! InfinityCoder backend.
//!
//! Everything the agent can touch lives here: the workspace file system, the
//! terminal, the SQLite project ledger, git and a minimal HTTP client. Every
//! path is resolved against the workspace root and rejected if it escapes it.

use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};

const DEFAULT_AI_HOST: &str = "127.0.0.1";
const DEFAULT_AI_PORT: u16 = 8080;
const MAX_OUTPUT: usize = 200_000;
const MAX_READ: u64 = 2_000_000;

#[derive(Clone)]
struct AppState {
    ai_process: Arc<Mutex<Option<Child>>>,
    ai_status: Arc<Mutex<String>>,
    ai_host: Arc<Mutex<String>>,
    ai_port: Arc<Mutex<u16>>,
    /// Search roots are remembered so a swarm worker can never widen its scope.
    gatekeeper: Arc<Mutex<std::collections::HashMap<String, Vec<String>>>>,
}

impl AppState {
    fn record(&self, agent: &str, action: &str) {
        if let Ok(mut map) = self.gatekeeper.lock() {
            let entry = map.entry(agent.to_string()).or_default();
            entry.push(action.to_string());
            if entry.len() > 24 {
                let excess = entry.len() - 24;
                entry.drain(0..excess);
            }
        }
    }

    fn seen(&self, agent: &str, action: &str) -> bool {
        self.gatekeeper
            .lock()
            .map(|map| map.get(agent).map(|a| a.iter().any(|x| x == action)).unwrap_or(false))
            .unwrap_or(false)
    }
}

/* ================================================================== *
 * Serialisation helpers
 * ================================================================== */

#[derive(Serialize, Clone)]
struct FileItem {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: u64,
}

#[derive(Serialize, Clone)]
struct FileMeta {
    path: String,
    is_dir: bool,
    size: u64,
    modified: u64,
}

#[derive(Serialize, Clone)]
struct Entry {
    key: String,
    description: String,
    file_path: String,
    kind: String,
    tags: String,
    updated_at: i64,
}

#[derive(Serialize, Clone)]
struct SearchMatch {
    path: String,
    line: usize,
    text: String,
}

#[derive(Serialize, Clone)]
struct CommandResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    timed_out: bool,
}

#[derive(Serialize, Clone)]
struct WorkspaceInfo {
    root: String,
    files: usize,
    symbols: usize,
    memories: usize,
    is_repo: bool,
}

#[derive(Serialize, Clone)]
struct GitStatus {
    branch: String,
    ahead: u32,
    behind: u32,
    staged: usize,
    changed: usize,
    untracked: usize,
    clean: bool,
    is_repo: bool,
}

#[derive(Serialize, Clone)]
struct Commit {
    hash: String,
    author: String,
    date: String,
    message: String,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/* ================================================================== *
 * Path safety
 * ================================================================== */

/// Resolve `user_path` inside `root`, refusing anything that escapes it.
/// Non-existent tails are allowed so new files can be created.
fn scoped(root: &Path, user_path: &str) -> Result<PathBuf, String> {
    let raw = user_path.trim();
    if raw.is_empty() {
        return Err("Путь не указан".into());
    }
    let p = Path::new(raw);
    let full = if p.is_absolute() { p.to_path_buf() } else { root.join(p) };
    let canon_root = root.canonicalize().map_err(|e| e.to_string())?;

    let mut cursor = full;
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if cursor.exists() {
            break;
        }
        match cursor.file_name() {
            Some(name) => {
                tail.push(name.to_os_string());
                match cursor.parent() {
                    Some(parent) if parent != cursor => cursor = parent.to_path_buf(),
                    _ => return Err("Некорректный путь".into()),
                }
            }
            None => break,
        }
    }
    let mut canon = cursor.canonicalize().map_err(|e| e.to_string())?;
    for name in tail.into_iter().rev() {
        canon.push(name);
    }
    if !canon.starts_with(&canon_root) {
        return Err("Путь выходит за пределы проекта".into());
    }
    Ok(canon)
}

/// Guard against `..` in *user supplied* paths that do not exist yet.
fn reject_traversal(user_path: &str) -> Result<(), String> {
    if Path::new(user_path)
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("«..» в пути запрещён".into());
    }
    Ok(())
}

const IGNORED: &[&str] = &[
    ".git",
    ".infinitycoder",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".venv",
    "__pycache__",
    ".cache",
    "vendor",
    ".gradle",
    ".idea",
    ".vscode",
];

/* ================================================================== *
 * Project ledger
 * ================================================================== */

fn db(root: &Path) -> Result<Connection, String> {
    fs::create_dir_all(root.join(".infinitycoder")).map_err(|e| e.to_string())?;
    let c = Connection::open(root.join(".infinitycoder").join("ledger.db")).map_err(|e| e.to_string())?;
    c.busy_timeout(Duration::from_secs(8)).map_err(|e| e.to_string())?;
    Ok(c)
}

fn ledger_init(root: &Path) -> Result<(), String> {
    let c = db(root)?;
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS ledger(
            key TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            file_path TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'note',
            tags TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS ledger_tokens(
            token TEXT NOT NULL,
            ledger_key TEXT NOT NULL,
            PRIMARY KEY(token, ledger_key)
        );
        CREATE INDEX IF NOT EXISTS idx_ledger_tokens_token ON ledger_tokens(token);",
    )
    .map_err(|e| e.to_string())?;

    // Migrations for databases written by older builds.
    let has_kind: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('ledger') WHERE name='kind'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if has_kind == 0 {
        c.execute("ALTER TABLE ledger ADD COLUMN kind TEXT NOT NULL DEFAULT 'note'", [])
            .map_err(|e| e.to_string())?;
        c.execute("ALTER TABLE ledger ADD COLUMN tags TEXT NOT NULL DEFAULT ''", [])
            .map_err(|e| e.to_string())?;
        c.execute("UPDATE ledger SET updated_at=unixepoch() WHERE updated_at=0", [])
            .map_err(|e| e.to_string())?;
    }

    let token_count: i64 = c.query_row("SELECT COUNT(*) FROM ledger_tokens", [], |r| r.get(0)).unwrap_or(0);
    if token_count == 0 {
        let existing: Vec<(String, String, String)> = {
            let mut s = c.prepare("SELECT key,description,file_path FROM ledger").map_err(|e| e.to_string())?;
            s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect()
        };
        for (key, description, file_path) in existing {
            upsert_tokens(&c, &key, &format!("{} {} {}", description, file_path, key))?;
        }
    }
    Ok(())
}

fn normalize_tokens(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    for ch in text.chars() {
        if ch.is_alphanumeric() || ch == '_' || ch == '-' || ch == '.' || ch == '/' {
            cur.extend(ch.to_lowercase());
        } else if cur.len() >= 2 {
            out.push(std::mem::take(&mut cur));
        } else {
            cur.clear();
        }
    }
    if cur.len() >= 2 {
        out.push(cur);
    }
    out.sort();
    out.dedup();
    out.into_iter().take(120).collect()
}

fn upsert_tokens(c: &Connection, key: &str, text: &str) -> Result<(), String> {
    c.execute("DELETE FROM ledger_tokens WHERE ledger_key=?1", params![key]).map_err(|e| e.to_string())?;
    for token in normalize_tokens(text) {
        c.execute(
            "INSERT OR IGNORE INTO ledger_tokens(token,ledger_key) VALUES(?1,?2)",
            params![token, key],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn upsert_ledger(c: &Connection, key: &str, description: &str, file_path: &str, kind: &str, tags: &str) -> Result<(), String> {
    c.execute(
        "INSERT INTO ledger(key,description,file_path,kind,tags,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6)
         ON CONFLICT(key) DO UPDATE SET
           description=excluded.description,
           file_path=excluded.file_path,
           kind=excluded.kind,
           tags=excluded.tags,
           updated_at=excluded.updated_at",
        params![key, description, file_path, kind, tags, now_secs()],
    )
    .map_err(|e| e.to_string())?;
    upsert_tokens(c, key, &format!("{} {} {} {} {}", key, description, file_path, kind, tags))
}

fn entry_from(r: &rusqlite::Row) -> rusqlite::Result<Entry> {
    Ok(Entry {
        key: r.get(0)?,
        description: r.get(1)?,
        file_path: r.get(2)?,
        kind: r.get::<_, Option<String>>(3)?.unwrap_or_else(|| "note".into()),
        tags: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
        updated_at: r.get(5)?,
    })
}

const SELECT_COLS: &str = "key,description,file_path,kind,tags,updated_at";

fn search_ledger_inner(root: &Path, query: &str, limit: usize) -> Result<Vec<Entry>, String> {
    ledger_init(root)?;
    let c = db(root)?;
    let tokens = normalize_tokens(query);
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    let mut scores: std::collections::HashMap<String, i32> = std::collections::HashMap::new();
    for token in &tokens {
        let mut s = c
            .prepare("SELECT ledger_key FROM ledger_tokens WHERE token=?1 LIMIT 400")
            .map_err(|e| e.to_string())?;
        let rows = s.query_map(params![token], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            *scores.entry(row).or_insert(0) += 1;
        }
    }
    let mut ranked: Vec<(String, i32)> = scores.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    ranked.truncate(limit.max(1) * 2);

    let mut out = Vec::new();
    for (key, _) in ranked {
        let sql = format!("SELECT {} FROM ledger WHERE key=?1", SELECT_COLS);
        if let Ok(row) = c.query_row(&sql, params![key], entry_from) {
            out.push(row);
            if out.len() >= limit.max(1) {
                break;
            }
        }
    }
    Ok(out)
}

/* ================================================================== *
 * Ghost index — automatic memory of every file the agent writes
 * ================================================================== */

fn declaration(line: &str) -> Option<(&'static str, String)> {
    let t = line.trim();
    let t = t.strip_prefix("export ").unwrap_or(t);
    let t = t.strip_prefix("pub ").unwrap_or(t);
    let t = t.strip_prefix("default ").unwrap_or(t);
    for (prefix, kind) in [
        ("fn ", "function"),
        ("function ", "function"),
        ("def ", "function"),
        ("class ", "class"),
        ("interface ", "interface"),
        ("struct ", "struct"),
        ("enum ", "enum"),
        ("trait ", "trait"),
        ("impl ", "impl"),
        ("type ", "type"),
        ("const ", "variable"),
        ("let ", "variable"),
        ("var ", "variable"),
    ] {
        if let Some(rest) = t.strip_prefix(prefix) {
            let name: String = rest
                .split(|c: char| c.is_whitespace() || c == '(' || c == ':' || c == '=' || c == '{' || c == '<')
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if name.len() >= 2 {
                return Some((kind, name));
            }
        }
    }
    None
}

fn hash_content(content: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut h);
    h.finish()
}

fn ghost_update(root: &Path, rel_path: &str, content: &str) -> Result<(), String> {
    ledger_init(root)?;
    let c = db(root)?;

    let declarations: Vec<(&'static str, String, usize)> = content
        .lines()
        .enumerate()
        .filter_map(|(i, line)| declaration(line).map(|(k, n)| (k, n, i + 1)))
        .take(400)
        .collect();

    let summary = format!(
        "File {} — {} bytes, {} declarations",
        rel_path,
        content.len(),
        declarations.len()
    );
    let file_key = format!("file:{}", rel_path);
    upsert_ledger(&c, &file_key, &summary, rel_path, "file", "")?;

    // Drop symbols that no longer exist in the file.
    let prefix = format!("symbol:{}::", rel_path);
    let like = format!("{}%", prefix);
    let stale: Vec<String> = {
        let mut s = c.prepare("SELECT key FROM ledger WHERE key LIKE ?1").map_err(|e| e.to_string())?;
        s.query_map(params![like], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect()
    };
    for key in stale {
        c.execute("DELETE FROM ledger WHERE key=?1", params![key.clone()]).map_err(|e| e.to_string())?;
        c.execute("DELETE FROM ledger_tokens WHERE ledger_key=?1", params![key]).map_err(|e| e.to_string())?;
    }

    for (kind, name, line_no) in declarations {
        let key = format!("{}{}", prefix, name);
        let desc = format!("{} '{}' declared in {} at line {}", kind, name, rel_path, line_no);
        upsert_ledger(&c, &key, &desc, rel_path, "symbol", kind)?;
    }
    Ok(())
}

fn walk_source_files(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 12 || out.len() > 20_000 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if IGNORED.contains(&name.as_str()) || name.starts_with('.') {
            continue;
        }
        let p = e.path();
        if p.is_dir() {
            walk_source_files(&p, out, depth + 1);
        } else {
            out.push(p);
        }
    }
}

/* ================================================================== *
 * AI process supervision
 * ================================================================== */

fn http_health(host: &str, port: u16) -> bool {
    let Some(addr) = (host, port).to_socket_addrs().ok().and_then(|mut x| x.next()) else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(600)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1200)));
    if stream
        .write_all(format!("GET /health HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n", host).as_bytes())
        .is_err()
    {
        return false;
    }
    let mut buf = [0u8; 256];
    let Ok(n) = stream.read(&mut buf) else { return false };
    String::from_utf8_lossy(&buf[..n]).contains(" 200 ")
}

fn start_ai(resource_dir: &Path, app_data_dir: &Path, state: &AppState) -> Result<(), String> {
    let server = resource_dir.join("bin").join("llama-server-vulkan.exe");
    let model_dir = app_data_dir.join("models");
    fs::create_dir_all(&model_dir).map_err(|e| format!("Не удалось создать папку моделей: {e}"))?;
    let model = model_dir.join("qwen-coder.gguf");

    if !server.is_file() {
        // A missing bundled runtime is not fatal: the user may run their own
        // llama-server, so we report a clear status instead of refusing to start.
        return Err(format!(
            "Встроенный llama-server не найден ({})",
            server.display()
        ));
    }
    if !model.is_file() {
        return Err(format!(
            "Модель не найдена: {}. Скачайте её в папку моделей или используйте облачного провайдера.",
            model.display()
        ));
    }

    let mut guard = state.ai_process.lock().map_err(|_| "poisoned".to_string())?;
    if guard.is_some() {
        return Ok(());
    }
    if let Ok(mut s) = state.ai_status.lock() {
        *s = "starting".into();
    }
    let (host, port) = current_ai(&state);
    let child = Command::new(&server)
        .args([
            "-m",
            model.to_string_lossy().as_ref(),
            "-ngl",
            "999",
            "-c",
            "8192",
            "-n",
            "-1",
            "--host",
            &host,
            "--port",
            &port.to_string(),
            "--alias",
            "qwen-coder",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Не удалось запустить llama-server: {e}"))?;
    *guard = Some(child);
    Ok(())
}

fn current_ai(state: &AppState) -> (String, u16) {
    let host = state.ai_host.lock().map(|s| s.clone()).unwrap_or_else(|_| DEFAULT_AI_HOST.to_string());
    let port = state.ai_port.lock().map(|p| *p).unwrap_or(DEFAULT_AI_PORT);
    (host, port)
}

fn start_ai_background(resource_dir: PathBuf, app_data_dir: PathBuf, state: AppState) {
    thread::spawn(move || {
        if let Err(e) = start_ai(&resource_dir, &app_data_dir, &state) {
            if let Ok(mut s) = state.ai_status.lock() {
                *s = format!("error:{e}");
            }
            return;
        }
        for _ in 0..480 {
            let (host, port) = current_ai(&state);
            if http_health(&host, port) {
                if let Ok(mut s) = state.ai_status.lock() {
                    *s = "ready".into();
                }
                return;
            }
            thread::sleep(Duration::from_millis(500));
        }
        if let Ok(mut s) = state.ai_status.lock() {
            *s = "error:модель загружается дольше 4 минут".into();
        }
    });
}

#[tauri::command]
fn ai_status(state: State<AppState>) -> Result<String, String> {
    state.ai_status.lock().map(|s| s.clone()).map_err(|_| "lock".into())
}

#[tauri::command]
fn set_ai_endpoint(host: Option<String>, port: Option<u16>, state: State<AppState>) -> Result<(), String> {
    if let Some(h) = host {
        if let Ok(mut s) = state.ai_host.lock() {
            *s = h;
        }
    }
    if let Some(p) = port {
        if let Ok(mut s) = state.ai_port.lock() {
            *s = p.clamp(1, 65535);
        }
    }
    Ok(())
}

/* ================================================================== *
 * Workspace commands
 * ================================================================== */

#[tauri::command]
async fn set_workspace_scope(path: String) -> Result<(), String> {
    let p = PathBuf::from(path);
    if !p.is_dir() {
        return Err("Это не папка".into());
    }
    let p = p.canonicalize().map_err(|e| e.to_string())?;
    ledger_init(&p)
}

#[tauri::command]
async fn workspace_info(workspace_root: String) -> Result<WorkspaceInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        ledger_init(&root)?;
        let c = db(&root)?;
        let memories: i64 = c.query_row("SELECT COUNT(*) FROM ledger", [], |r| r.get(0)).unwrap_or(0);
        let symbols: i64 = c
            .query_row("SELECT COUNT(*) FROM ledger WHERE kind='symbol'", [], |r| r.get(0))
            .unwrap_or(0);
        let mut files = Vec::new();
        walk_source_files(&root, &mut files, 0);
        Ok(WorkspaceInfo {
            root: root.to_string_lossy().to_string(),
            files: files.len(),
            symbols: symbols as usize,
            memories: memories as usize,
            is_repo: root.join(".git").exists(),
        })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn list_dir(workspace_root: String, path: String) -> Result<Vec<FileItem>, String> {
    tauri::async_runtime::spawn_blocking(move || list_dir_sync(&workspace_root, &path, 1))
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

fn list_dir_sync(root_str: &str, path: &str, depth: usize) -> Result<Vec<FileItem>, String> {
    let root = Path::new(root_str).canonicalize().map_err(|e| e.to_string())?;
    let dir = if path.trim().is_empty() { root.clone() } else { scoped(&root, path)? };
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if IGNORED.contains(&name.as_str()) {
            continue;
        }
        let p = entry.path();
        let meta = entry.metadata().ok();
        let is_dir = p.is_dir();
        if is_dir && depth < 1 {
            // One level of children keeps the palette useful without a full walk.
            if let Ok(children) = fs::read_dir(&p) {
                for c in children.flatten() {
                    if let Some(cm) = c.metadata().ok() {
                        if cm.is_file() {
                            out.push(FileItem {
                                name: c.file_name().to_string_lossy().to_string(),
                                path: c.path().to_string_lossy().to_string(),
                                is_dir: false,
                                size: cm.len(),
                                modified: file_mtime(&cm),
                            });
                        }
                    }
                }
            }
        }
        out.push(FileItem {
            name,
            path: p.to_string_lossy().to_string(),
            is_dir,
            size: meta.as_ref().filter(|m| m.is_file()).map(|m| m.len()).unwrap_or(0),
            modified: meta.as_ref().map(file_mtime).unwrap_or(0),
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out.dedup_by(|a, b| a.path == b.path);
    Ok(out)
}

fn file_mtime(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
async fn file_stat(workspace_root: String, path: String) -> Result<FileMeta, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let p = scoped(&root, &path)?;
        let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
        Ok(FileMeta {
            path: p.to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified: file_mtime(&meta),
        })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/* ================================================================== *
 * File IO
 * ================================================================== */

#[tauri::command]
async fn read_file(
    workspace_root: String,
    path: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
    agent: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let agent = agent.unwrap_or_else(|| "main".into());
    state.record(&agent, "read_file");
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let p = scoped(&root, &path)?;
        let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
        if meta.len() > MAX_READ {
            return Err(format!(
                "Файл слишком большой ({} МБ). Читайте по частям через start_line/end_line.",
                meta.len() / 1_048_576
            ));
        }
        let text = fs::read_to_string(&p).map_err(|e| e.to_string())?;
        if start_line.is_none() && end_line.is_none() {
            return Ok(text);
        }
        let from = start_line.unwrap_or(1).saturating_sub(1);
        let to = end_line.unwrap_or(usize::MAX);
        Ok(text
            .lines()
            .enumerate()
            .skip(from)
            .take(to.saturating_sub(from))
            .map(|(_, l)| l.to_string())
            .collect::<Vec<_>>()
            .join("\n"))
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn write_file(
    workspace_root: String,
    path: String,
    content: String,
    agent: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let agent = agent.unwrap_or_else(|| "main".into());
    state.record(&agent, "write_file");
    tauri::async_runtime::spawn_blocking(move || {
        reject_traversal(&path)?;
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let p = scoped(&root, &path)?;
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let name = p.file_name().and_then(|x| x.to_str()).unwrap_or("file").to_string();
        let tmp = p.with_file_name(format!(".{}.{}.tmp", name, std::process::id()));
        fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
        replace_file(&tmp, &p)?;
        ghost_update(&root, &path, &content)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/// Atomic replacement that also works on Windows when the target exists.
fn replace_file(tmp: &Path, target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
        }
        const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
        const MOVEFILE_COPY_ALLOWED: u32 = 0x2;
        let w_target: Vec<u16> = target.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let w_tmp: Vec<u16> = tmp.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let ok = unsafe { MoveFileExW(w_tmp.as_ptr(), w_target.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_COPY_ALLOWED) };
        if ok == 0 {
            fs::remove_file(target).ok();
            fs::rename(tmp, target).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        fs::rename(tmp, target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn edit_file(
    workspace_root: String,
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
    agent: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let agent = agent.unwrap_or_else(|| "main".into());
    state.record(&agent, "edit_file");
    let replace_all = replace_all.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        reject_traversal(&path)?;
        if old_string.is_empty() {
            return Err("old_string пустой".into());
        }
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let p = scoped(&root, &path)?;
        let content = fs::read_to_string(&p).map_err(|e| e.to_string())?;
        let hits = content.matches(&old_string).count();
        if hits == 0 {
            let head: String = content.chars().take(160).collect();
            return Err(format!(
                "old_string не найден в файле. Начало файла:\n{}",
                head
            ));
        }
        let next = if replace_all {
            content.replace(&old_string, &new_string)
        } else {
            content.replacen(&old_string, &new_string, 1)
        };
        let name = p.file_name().and_then(|x| x.to_str()).unwrap_or("file").to_string();
        let tmp = p.with_file_name(format!(".{}.{}.tmp", name, std::process::id()));
        fs::write(&tmp, next.as_bytes()).map_err(|e| e.to_string())?;
        replace_file(&tmp, &p)?;
        ghost_update(&root, &path, &next)?;
        Ok(if replace_all {
            format!("Заменено вхождений: {}", hits)
        } else {
            format!("Заменено 1 из {} вхождений", hits)
        })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn delete_file(workspace_root: String, path: String, agent: Option<String>) -> Result<(), String> {
    let _ = agent;
    tauri::async_runtime::spawn_blocking(move || {
        reject_traversal(&path)?;
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let p = scoped(&root, &path)?;
        if p == root {
            return Err("Нельзя удалить корень проекта".into());
        }
        let meta = fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            fs::remove_dir_all(&p).map_err(|e| e.to_string())
        } else {
            fs::remove_file(&p).map_err(|e| e.to_string())
        }
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn move_file(workspace_root: String, from: String, to: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        reject_traversal(&from)?;
        reject_traversal(&to)?;
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let src = scoped(&root, &from)?;
        let dst = scoped(&root, &to)?;
        if dst.exists() {
            return Err(format!("Файл уже существует: {}", to));
        }
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::rename(&src, &dst).map_err(|e| e.to_string())?;
        // Keep the ghost index in sync with the move.
        let _ = ledger_init(&root);
        if let Ok(c) = db(&root) {
            let src_key = format!("file:{}", from);
            let _ = c.execute("DELETE FROM ledger WHERE key=?1", params![src_key.clone()]);
            let _ = c.execute("DELETE FROM ledger_tokens WHERE ledger_key=?1", params![src_key]);
            let _ = c.execute(
                "UPDATE ledger SET file_path=?1 WHERE file_path=?2",
                params![to, from],
            );
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn create_dir(workspace_root: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        reject_traversal(&path)?;
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let p = scoped(&root, &path)?;
        fs::create_dir_all(&p).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn search_files(
    workspace_root: String,
    path: String,
    query: String,
    glob: String,
    max_results: Option<usize>,
) -> Result<Vec<SearchMatch>, String> {
    let max = max_results.unwrap_or(120).clamp(1, 1000);
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let base = if path.trim().is_empty() { root.clone() } else { scoped(&root, &path)? };
        let needle = query.to_lowercase();
        let mut files = Vec::new();
        walk_source_files(&base, &mut files, 0);
        let mut out = Vec::new();
        for f in files {
            if out.len() >= max {
                break;
            }
            let rel = f.strip_prefix(&root).unwrap_or(&f).to_string_lossy().replace('\\', "/");
            if !glob.trim().is_empty() && !glob_match(&rel, glob.trim()) {
                continue;
            }
            let Ok(text) = fs::read_to_string(&f) else { continue };
            for (i, line) in text.lines().enumerate() {
                if out.len() >= max {
                    break;
                }
                if line.to_lowercase().contains(&needle) {
                    out.push(SearchMatch {
                        path: rel.clone(),
                        line: i + 1,
                        text: line.trim().chars().take(300).collect(),
                    });
                }
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

fn glob_match(path: &str, glob: &str) -> bool {
    // Translate a glob into a simple matcher supporting `**`, `*` and `?`.
    let g = glob.replace("**/", "\u{1}").replace('*', "\u{2}").replace('?', "\u{3}");
    let mut pattern = String::from("^");
    for ch in g.chars() {
        match ch {
            '\u{1}' => pattern.push_str("(?:.*/)?"),
            '\u{2}' => pattern.push_str("[^/]*"),
            '\u{3}' => pattern.push('.'),
            c if "\\.+^$|()[]{}".contains(c) => {
                pattern.push('\\');
                pattern.push(c);
            }
            c => pattern.push(c),
        }
    }
    pattern.push('$');
    match regex_lite_match(&pattern, path) {
        Some(v) => v,
        None => false,
    }
}

/// Minimal regex-free fallback: exact match when the glob has no wildcards.
fn regex_lite_match(pattern: &str, text: &str) -> Option<bool> {
    // We only need `^`, `$`, `\`, `?` as `.`, and character classes are rare
    // enough in agent usage that a straightforward scanner suffices.
    let chars: Vec<char> = pattern.chars().collect();
    let text: Vec<char> = text.chars().collect();
    let anchored_start = chars.first() == Some(&'^');
    let anchored_end = chars.last() == Some(&'$');
    let body: Vec<char> = {
        let mut b = chars.clone();
        if anchored_start {
            b.remove(0);
        }
        if anchored_end && !b.is_empty() {
            b.pop();
        }
        b
    };

    fn walk(body: &[char], text: &[char]) -> bool {
        if body.is_empty() {
            return text.is_empty();
        }
        // `(?:...)?` group
        if body.starts_with(&['(', '?', ':']) {
            if let Some(close) = find_group_end(body) {
                let inner = &body[3..close];
                let after = &body[close + 3..]; // ) + rest
                if after.len() > 1 && after[0] == '?' && after[1] == ')' {
                    if walk(&after[2..], text) {
                        return true;
                    }
                }
                if walk(&after, text) {
                    return true;
                }
                let mut consumed = 0usize;
                while consumed <= text.len() {
                    if walk(inner, &text[consumed..]) && walk(&after[2..], &text[consumed..]) {
                        return true;
                    }
                    consumed += 1;
                }
                return false;
            }
        }
        let (one, rest) = (body[0], &body[1..]);
        match one {
            '\u{2}' => {
                let mut n = 0;
                while n < text.len() && text[n] != '/' {
                    if walk(rest, &text[n + 1..]) {
                        return true;
                    }
                    n += 1;
                }
                walk(rest, &text[n..])
            }
            '\u{3}' => !text.is_empty() && walk(rest, &text[1..]),
            '\\' => !rest.is_empty() && !text.is_empty() && rest[0] == text[0] && walk(&rest[1..], &text[1..]),
            c => {
                if c == '[' {
                    if let Some(close) = body.iter().position(|x| *x == ']') {
                        let set = &body[1..close];
                        if !text.is_empty() && set.contains(&text[0]) {
                            return walk(&body[close + 1..], &text[1..]);
                        }
                        return false;
                    }
                }
                !text.is_empty() && text[0] == c && walk(rest, &text[1..])
            }
        }
    }

    fn find_group_end(body: &[char]) -> Option<usize> {
        let mut depth = 0;
        for (i, c) in body.iter().enumerate() {
            match c {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(i);
                    }
                }
                _ => {}
            }
        }
        None
    }

    let ok = if anchored_start {
        walk(&body, &text)
    } else {
        let mut found = false;
        let mut i = 0;
        while i <= text.len() {
            if walk(&body, &text[i..]) {
                found = true;
                break;
            }
            i += 1;
        }
        found
    };
    Some(ok)
}

/* ================================================================== *
 * Terminal
 * ================================================================== */

#[tauri::command]
async fn run_command(
    workspace_root: String,
    command: String,
    timeout_seconds: Option<u64>,
    agent: Option<String>,
) -> Result<CommandResult, String> {
    let _ = agent;
    let limit = timeout_seconds.unwrap_or(120).clamp(1, 600);
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return Err("Пустая команда".into());
        }
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", trimmed]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", trimmed]);
            c };
        cmd.current_dir(&root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Не удалось запустить команду: {e}"))?;
        let mut so = child.stdout.take().unwrap();
        let mut se = child.stderr.take().unwrap();
        let reader = std::thread::spawn(move || {
            let mut a = String::new();
            let mut b = String::new();
            let _ = so.read_to_string(&mut a);
            let _ = se.read_to_string(&mut b);
            (a, b)
        });

        let deadline = Instant::now() + Duration::from_secs(limit);
        let mut timed_out = false;
        let status = loop {
            match child.try_wait() {
                Ok(Some(s)) => break Ok(s),
                Ok(None) => {
                    if Instant::now() >= deadline {
                        timed_out = true;
                        let _ = child.kill();
                        break child.wait();
                    }
                    thread::sleep(Duration::from_millis(40));
                }
                Err(e) => break Err(e),
            }
        };
        let (stdout, stderr) = reader.join().unwrap_or_default();
        let exit_code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
        Ok(CommandResult {
            stdout: truncate_output(&stdout, MAX_OUTPUT),
            stderr: truncate_output(&stderr, MAX_OUTPUT / 4),
            exit_code,
            timed_out,
        })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

fn truncate_output(s: &str, cap: usize) -> String {
    let (safe, _) = s.as_bytes().split_at(std::cmp::min(cap, s.len()));
    String::from_utf8_lossy(safe).to_string()
}

/* ================================================================== *
 * Ledger commands
 * ================================================================== */

#[tauri::command]
async fn memory_search(
    workspace_root: String,
    query: String,
    limit: Option<usize>,
    agent: Option<String>,
) -> Result<Vec<Entry>, String> {
    let _ = agent;
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        search_ledger_inner(&root, &query, limit.unwrap_or(8))
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn memory_write(
    workspace_root: String,
    key: String,
    description: String,
    file_path: String,
    kind: Option<String>,
    tags: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        ledger_init(&root)?;
        let c = db(&root)?;
        upsert_ledger(&c, &key, &description, &file_path, &kind.unwrap_or_else(|| "note".into()), &tags.unwrap_or_default())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn memory_list(workspace_root: String, limit: Option<usize>, kind: Option<String>) -> Result<Vec<Entry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        ledger_init(&root)?;
        let c = db(&root)?;
        let n = limit.unwrap_or(100).clamp(1, 2000) as i64;
        let kind = kind.unwrap_or_default();
        let sql = if kind.trim().is_empty() {
            format!("SELECT {} FROM ledger ORDER BY updated_at DESC LIMIT {}", SELECT_COLS, n)
        } else {
            format!(
                "SELECT {} FROM ledger WHERE kind=?1 ORDER BY updated_at DESC LIMIT {}",
                SELECT_COLS, n
            )
        };
        let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = if kind.trim().is_empty() {
            stmt.query_map([], entry_from).map_err(|e| e.to_string())?
        } else {
            stmt.query_map(params![kind], entry_from).map_err(|e| e.to_string())?
        };
        Ok(rows.filter_map(Result::ok).collect())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn memory_forget(workspace_root: String, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        ledger_init(&root)?;
        let c = db(&root)?;
        c.execute("DELETE FROM ledger WHERE key=?1", params![key.clone()]).map_err(|e| e.to_string())?;
        c.execute("DELETE FROM ledger_tokens WHERE ledger_key=?1", params![key]).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn memory_reindex(workspace_root: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        ledger_init(&root)?;
        let mut files = Vec::new();
        walk_source_files(&root, &mut files, 0);
        let mut done = 0usize;
        for f in files {
            if f.extension().map(|e| e == "lock").unwrap_or(false) {
                continue;
            }
            let Ok(content) = fs::read_to_string(&f) else { continue };
            if content.len() > 1_500_000 {
                continue;
            }
            let rel = f.strip_prefix(&root).unwrap_or(&f).to_string_lossy().replace('\\', "/");
            if ghost_update(&root, &rel, &content).is_ok() {
                done += 1;
            }
            if done >= 5000 {
                break;
            }
        }
        Ok(done)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/* ================================================================== *
 * Git
 * ================================================================== */

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    if !root.join(".git").exists() {
        return Err("Это не git-репозиторий".into());
    }
    let out = Command::new("git")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("git недоступен: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() { format!("git завершился с кодом {:?}", out.status.code()) } else { stderr });
    }
    Ok(stdout)
}

#[tauri::command]
async fn git_status(workspace_root: String) -> Result<GitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        if !root.join(".git").exists() {
            return Ok(GitStatus {
                branch: "—".into(),
                ahead: 0,
                behind: 0,
                staged: 0,
                changed: 0,
                untracked: 0,
                clean: true,
                is_repo: false,
            });
        }
        let branch = git(&root, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|_| "—".into());
        let porcelain = git(&root, &["status", "--porcelain"]).unwrap_or_default();
        let mut staged = 0;
        let mut changed = 0;
        let mut untracked = 0;
        for line in porcelain.lines() {
            let code = line.chars().next().unwrap_or(' ');
            if code == '?' {
                untracked += 1;
            } else {
                if code != ' ' && code != '?' {
                    staged += 1;
                }
                if line.chars().nth(1).map(|c| c != ' ').unwrap_or(false) {
                    changed += 1;
                }
            }
        }
        let upstream = git(&root, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).unwrap_or_default();
        let (ahead, behind) = if upstream.trim().is_empty() {
            (0, 0)
        } else {
            let counts = git(&root, &["rev-list", "--left-right", "--count", "HEAD...@{u}"]).unwrap_or_default();
            let mut it = counts.split_whitespace();
            (
                it.next().and_then(|s| s.parse().ok()).unwrap_or(0),
                it.next().and_then(|s| s.parse().ok()).unwrap_or(0),
            )
        };
        Ok(GitStatus {
            branch: branch.trim().to_string(),
            ahead,
            behind,
            staged,
            changed,
            untracked,
            clean: porcelain.trim().is_empty(),
            is_repo: true,
        })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn git_diff(workspace_root: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let mut args: Vec<&str> = vec!["diff", "--stat", "HEAD"];
        if !path.trim().is_empty() {
            reject_traversal(&path)?;
            scoped(&root, &path)?;
            args.push("--");
            args.push(&path);
        }
        let out = git(&root, &args)?;
        Ok(truncate_output(&out, MAX_OUTPUT))
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn git_log(workspace_root: String, limit: Option<usize>) -> Result<Vec<Commit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        let n = limit.unwrap_or(20).clamp(1, 200).to_string();
        let fmt = format!("--max-count={}", n);
        let out = git(
            &root,
            &["log", &fmt, "--pretty=format:%H%x1f%an%x1f%ad%x1f%s", "--date=short"],
        )?;
        Ok(out
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.split('\u{1f}').collect();
                if parts.len() == 4 {
                    Some(Commit {
                        hash: parts[0].into(),
                        author: parts[1].into(),
                        date: parts[2].into(),
                        message: parts[3].into(),
                    })
                } else {
                    None
                }
            })
            .collect())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn git_commit(workspace_root: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        git(&root, &["add", "-A"])?;
        let staged = git(&root, &["diff", "--cached", "--quiet"]).is_err();
        if !staged {
            return Ok("Нет изменений для коммита".into());
        }
        git(&root, &["commit", "-m", &message])?;
        let head = git(&root, &["rev-parse", "--short", "HEAD"]).unwrap_or_default();
        Ok(format!("Коммит создан: {}", head.trim()))
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/* ================================================================== *
 * Network (curl-based, so we do not need an HTTP client dependency)
 * ================================================================== */

fn curl_available() -> Option<String> {
    for bin in ["curl.exe", "curl"] {
        if Command::new(bin)
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Some(bin.to_string());
        }
    }
    None
}

#[tauri::command]
async fn web_fetch(url: String, max_bytes: Option<usize>) -> Result<String, String> {
    let cap = max_bytes.unwrap_or(200_000);
    tauri::async_runtime::spawn_blocking(move || {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err("Нужен http(s)-адрес".into());
        }
        let bin = curl_available().ok_or("curl недоступен в этой системе")?;
        let out = Command::new(bin)
            .args([
                "-sSL",
                "--max-time",
                "25",
                "-A",
                "InfinityCoder/3.0",
                "--max-filesize",
                &format!("{}", cap * 2),
                &url,
            ])
            .stdin(Stdio::null())
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Загрузка не удалась: {}", err.trim().chars().take(200).collect::<String>()));
        }
        Ok(truncate_output(&String::from_utf8_lossy(&out.stdout), cap))
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn web_search(query: String, limit: Option<usize>) -> Result<Vec<SearchMatch>, String> {
    let n = limit.unwrap_or(5).clamp(1, 10);
    tauri::async_runtime::spawn_blocking(move || {
        let bin = curl_available().ok_or("curl недоступен в этой системе")?;
        let encoded: String = query
            .chars()
            .map(|c| match c {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
                ' ' => "%20".into(),
                other => other.to_string().into_bytes().iter().map(|b| format!("%{:02X}", b)).collect(),
            })
            .collect();
        let url = format!(
            "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
            encoded
        );
        let out = Command::new(bin)
            .args(["-sSL", "--max-time", "20", &url])
            .stdin(Stdio::null())
            .output()
            .map_err(|e| e.to_string())?;
        let body = String::from_utf8_lossy(&out.stdout).to_string();
        Ok(parse_duckduckgo(&body, n))
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

fn parse_duckduckgo(body: &str, limit: usize) -> Vec<SearchMatch> {
    let mut out = Vec::new();
    // The Instant Answer API returns a small, stable shape; a light scan is
    // enough and avoids pulling in a JSON dependency for two fields.
    let abstract_text = extract_json_string(body, "AbstractText");
    let heading = extract_json_string(body, "Heading").unwrap_or_else(|| "Результат".into());
    let url = extract_json_string(body, "AbstractURL").unwrap_or_default();
    if let Some(text) = abstract_text {
        if !text.trim().is_empty() {
            out.push(SearchMatch {
                path: url,
                line: 0,
                text: format!("{} — {}", heading, text),
            });
        }
    }
    for topic in extract_related(body).into_iter().take(limit) {
        if out.len() >= limit {
            break;
        }
        out.push(SearchMatch {
            path: topic.0,
            line: 0,
            text: topic.1,
        });
    }
    out
}

fn extract_json_string(body: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\"", key);
    let idx = body.find(&needle)?;
    let rest = &body[idx + needle.len()..];
    let rest = rest.trim_start().strip_prefix(':')?.trim_start();
    if !rest.starts_with('"') {
        return None;
    }
    let mut out = String::new();
    let mut chars = rest[1..].chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Some(out),
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('u') => {
                    let hex: String = chars.by_ref().take(4).collect();
                    if let Ok(code) = u32::from_str_radix(&hex, 16) {
                        if let Some(ch) = char::from_u32(code) {
                            out.push(ch);
                        }
                    }
                }
                Some(other) => out.push(other),
                None => break,
            },
            other => out.push(other),
        }
    }
    None
}

fn extract_related(body: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let key = "\"RelatedTopics\"";
    let Some(start) = body.find(key) else { return out };
    let rest = &body[start + key.len()..];
    let mut depth = 0i32;
    let mut in_str = false;
    let mut esc = false;
    let mut url = String::new();
    let mut text = String::new();
    let mut current: Vec<(String, String)> = Vec::new();
    for ch in rest.chars() {
        if in_str {
            if esc {
                esc = false;
            } else if ch == '\\' {
                esc = true;
            } else if ch == '"' {
                in_str = false;
            }
            continue;
        }
        match ch {
            '"' => in_str = true,
            '{' => {
                depth += 1;
                if depth == 1 {
                    url.clear();
                    text.clear();
                }
            }
            '}' => {
                if depth == 1 {
                    if !text.is_empty() {
                        current.push((url.clone(), text.clone()));
                    }
                }
                depth -= 1;
            }
            _ => {}
        }
    }
    out.append(&mut current);
    out
}

/* ================================================================== *
 * main
 * ================================================================== */

#[tauri::command]
fn app_version() -> &'static str {
    "3.0.0"
}

fn main() {
    let state = AppState {
        ai_process: Arc::new(Mutex::new(None)),
        ai_status: Arc::new(Mutex::new("starting".into())),
        ai_host: Arc::new(Mutex::new(DEFAULT_AI_HOST.to_string())),
        ai_port: Arc::new(Mutex::new(DEFAULT_AI_PORT)),
        gatekeeper: Arc::new(Mutex::new(std::collections::HashMap::new())),
    };

    let app = tauri::Builder::default()
        .manage(state.clone())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ai_status,
            set_ai_endpoint,
            app_version,
            set_workspace_scope,
            workspace_info,
            list_dir,
            file_stat,
            read_file,
            write_file,
            edit_file,
            delete_file,
            move_file,
            create_dir,
            search_files,
            run_command,
            memory_search,
            memory_write,
            memory_list,
            memory_forget,
            memory_reindex,
            git_status,
            git_diff,
            git_log,
            git_commit,
            web_fetch,
            web_search
        ])
        .build(tauri::generate_context!())
        .expect("не удалось собрать InfinityCoder");

    if let (Ok(resource), Ok(app_data)) = (app.path().resource_dir(), app.path().app_data_dir()) {
        start_ai_background(resource, app_data, state.clone());
    }

    app.run(move |handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Ok(mut guard) = handle.state::<AppState>().ai_process.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let deadline = Instant::now() + Duration::from_secs(5);
                    loop {
                        match child.try_wait() {
                            Ok(Some(_)) => break,
                            _ => {
                                if Instant::now() >= deadline {
                                    let _ = child.wait();
                                    break;
                                }
                                thread::sleep(Duration::from_millis(50));
                            }
                        }
                    }
                }
            }
        }
    });
}
