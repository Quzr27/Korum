use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify_debouncer_mini::notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind, Debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ── Types ──

#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
}

#[derive(Serialize, Clone)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Serialize, Clone)]
pub struct GitStatusResult {
    pub statuses: Vec<GitFileStatus>,
    pub changed_count: u32,
    pub insertions: u32,
    pub deletions: u32,
}

// ── Watcher state (with ref counting) ──

struct WatcherEntry {
    #[allow(dead_code)] // kept alive — dropped when removed from HashMap
    debouncer: Debouncer<RecommendedWatcher>,
    ref_count: u32,
}

pub struct FileWatcherState {
    watchers: Mutex<HashMap<String, WatcherEntry>>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

// ── Path confinement ──

const ALWAYS_EXCLUDE: &[&str] = &[".git", ".DS_Store", "Thumbs.db"];

/// Canonicalize `path` and verify it lives under `root`. Prevents path traversal.
fn confine_path(path: &str, root: &str) -> Result<PathBuf, String> {
    let canonical_root = std::fs::canonicalize(root)
        .map_err(|e| format!("Cannot resolve root path: {e}"))?;
    let canonical_path = std::fs::canonicalize(path)
        .map_err(|e| format!("Cannot resolve path: {e}"))?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err(format!(
            "Path escapes workspace root: {}",
            canonical_path.display()
        ));
    }
    Ok(canonical_path)
}

/// Like `confine_path` but for paths that don't exist yet (new file/dir).
/// Canonicalizes the parent and checks confinement.
fn confine_new_path(path: &str, root: &str) -> Result<PathBuf, String> {
    let target = Path::new(path);
    let parent = target
        .parent()
        .ok_or_else(|| "Cannot determine parent directory".to_string())?;
    let canonical_root = std::fs::canonicalize(root)
        .map_err(|e| format!("Cannot resolve root path: {e}"))?;
    let canonical_parent = std::fs::canonicalize(parent)
        .map_err(|e| format!("Cannot resolve parent path: {e}"))?;

    if !canonical_parent.starts_with(&canonical_root) {
        return Err(format!(
            "Path escapes workspace root: {}",
            canonical_parent.display()
        ));
    }

    let file_name = target
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?;

    Ok(canonical_parent.join(file_name))
}

// ── Directory reading ──

pub fn read_directory(path: &str) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(path);
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let gitignore = build_gitignore(dir_path);

    let mut entries = Vec::new();
    let read_dir =
        std::fs::read_dir(dir_path).map_err(|e| format!("Failed to read directory: {e}"))?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();

        if ALWAYS_EXCLUDE.contains(&name.as_str()) {
            continue;
        }

        let entry_path = entry.path();

        // Use symlink_metadata to not follow symlinks for type detection
        let sym_meta = match std::fs::symlink_metadata(&entry_path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_symlink = sym_meta.file_type().is_symlink();

        // For display purposes, resolve symlinks to determine if target is dir
        let is_dir = if is_symlink {
            entry_path.is_dir() // follows symlink
        } else {
            sym_meta.is_dir()
        };

        // Check gitignore
        if let Some(ref gi) = gitignore {
            let matched = gi.matched_path_or_any_parents(&entry_path, is_dir);
            if matched.is_ignore() {
                continue;
            }
        }

        entries.push(FileEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            is_symlink,
        });
    }

    // Sort: directories first, then files, case-insensitive alphabetical within each group
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

fn build_gitignore(dir_path: &Path) -> Option<ignore::gitignore::Gitignore> {
    // Find repo root by walking up to .git
    let mut current = dir_path;
    let repo_root = loop {
        if current.join(".git").exists() {
            break Some(current);
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => break None,
        }
    };

    let repo_root = repo_root?;

    let mut builder = ignore::gitignore::GitignoreBuilder::new(repo_root);

    // Walk from repo root down to dir_path, adding every .gitignore along the way
    let relative = dir_path.strip_prefix(repo_root).ok();
    let mut walk = repo_root.to_path_buf();

    // Add root .gitignore
    let root_gi = walk.join(".gitignore");
    if root_gi.exists() {
        builder.add(&root_gi);
    }

    // Add intermediate .gitignore files
    if let Some(rel) = relative {
        for component in rel.components() {
            walk.push(component);
            let gi = walk.join(".gitignore");
            if gi.exists() {
                builder.add(&gi);
            }
        }
    }

    builder.build().ok()
}

// ── Git status ──

pub fn get_git_status(root_path: &str) -> Result<GitStatusResult, String> {
    let repo = match git2::Repository::discover(root_path) {
        Ok(r) => r,
        Err(_) => {
            return Ok(GitStatusResult {
                statuses: Vec::new(),
                changed_count: 0,
                insertions: 0,
                deletions: 0,
            });
        }
    };

    let statuses = repo
        .statuses(Some(
            git2::StatusOptions::new()
                .include_untracked(true)
                .recurse_untracked_dirs(true),
        ))
        .map_err(|e| format!("Failed to get git status: {e}"))?;

    // Build per-file status map
    let mut status_map: HashMap<String, String> = HashMap::new();
    for entry in statuses.iter() {
        let path = match entry.path() {
            Some(p) => p.to_string(),
            None => continue,
        };

        let s = entry.status();
        let status_char = if s.contains(git2::Status::INDEX_NEW) {
            "A"
        } else if s.contains(git2::Status::INDEX_MODIFIED)
            || s.contains(git2::Status::WT_MODIFIED)
        {
            "M"
        } else if s.contains(git2::Status::INDEX_DELETED)
            || s.contains(git2::Status::WT_DELETED)
        {
            "D"
        } else if s.contains(git2::Status::INDEX_RENAMED)
            || s.contains(git2::Status::WT_RENAMED)
        {
            "R"
        } else if s.contains(git2::Status::WT_NEW) {
            "?"
        } else {
            continue;
        };

        status_map.insert(path, status_char.to_string());
    }

    // Compute per-file + total line stats from diff
    let (per_file_stats, total_ins, total_del) = compute_diff_stats(&repo);

    let mut result: Vec<GitFileStatus> = status_map
        .into_iter()
        .map(|(path, status)| {
            let (ins, del) = per_file_stats.get(path.as_str()).copied().unwrap_or((0, 0));
            GitFileStatus {
                path,
                status,
                insertions: ins,
                deletions: del,
            }
        })
        .collect();

    // Sort by path for consistent ordering
    result.sort_by(|a, b| a.path.cmp(&b.path));

    let changed_count = result.len() as u32;

    Ok(GitStatusResult {
        statuses: result,
        changed_count,
        insertions: total_ins,
        deletions: total_del,
    })
}

/// Returns (per_file_stats, total_insertions, total_deletions).
/// Per-file stats keyed by relative path.
fn compute_diff_stats(repo: &git2::Repository) -> (HashMap<String, (u32, u32)>, u32, u32) {
    let head_tree = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_tree().ok());

    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.include_untracked(true);

    let diff = match repo.diff_tree_to_workdir_with_index(
        head_tree.as_ref(),
        Some(&mut diff_opts),
    ) {
        Ok(d) => d,
        Err(_) => return (HashMap::new(), 0, 0),
    };

    // Total stats
    let (total_ins, total_del) = match diff.stats() {
        Ok(stats) => (stats.insertions() as u32, stats.deletions() as u32),
        Err(_) => (0, 0),
    };

    // Per-file stats via foreach
    let per_file = std::sync::Mutex::new(HashMap::<String, (u32, u32)>::new());
    let current_file = std::sync::Mutex::new(String::new());

    let _ = diff.foreach(
        &mut |delta, _| {
            if let Some(path) = delta.new_file().path().and_then(|p| p.to_str()) {
                *current_file.lock().unwrap() = path.to_string();
            }
            true
        },
        None, // binary callback
        None, // hunk callback
        Some(&mut |_delta, _hunk, line| {
            let file = current_file.lock().unwrap().clone();
            if !file.is_empty() {
                let mut map = per_file.lock().unwrap();
                let entry = map.entry(file).or_insert((0, 0));
                match line.origin() {
                    '+' => entry.0 += 1,
                    '-' => entry.1 += 1,
                    _ => {}
                }
            }
            true
        }),
    );

    (per_file.into_inner().unwrap(), total_ins, total_del)
}

// ── File content ──

const MAX_FILE_SIZE: u64 = 51_200; // 50 KB — opened as NoteWindow, persisted in state.json

pub fn read_file_content(path: &str) -> Result<String, String> {
    let file_path = Path::new(path);
    if !file_path.is_file() {
        return Err(format!("Not a file: {path}"));
    }

    let metadata =
        std::fs::metadata(file_path).map_err(|e| format!("Failed to read metadata: {e}"))?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large ({} bytes, max {} bytes)",
            metadata.len(),
            MAX_FILE_SIZE
        ));
    }

    std::fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {e}"))
}

// ── File operations (confined to workspace root) ──

pub fn create_file(path: &str, root: &str) -> Result<(), String> {
    let confined = confine_new_path(path, root)?;
    std::fs::File::create(&confined).map_err(|e| format!("Failed to create file: {e}"))?;
    Ok(())
}

pub fn create_directory(path: &str, root: &str) -> Result<(), String> {
    let confined = confine_new_path(path, root)?;
    std::fs::create_dir_all(&confined).map_err(|e| format!("Failed to create directory: {e}"))
}

pub fn rename_path(old_path: &str, new_path: &str, root: &str) -> Result<(), String> {
    let confined_old = confine_path(old_path, root)?;
    let confined_new = confine_new_path(new_path, root)?;
    std::fs::rename(&confined_old, &confined_new).map_err(|e| format!("Failed to rename: {e}"))
}

pub fn delete_path(path: &str, root: &str) -> Result<(), String> {
    let confined = confine_path(path, root)?;

    // Use symlink_metadata — don't follow symlinks into directories outside workspace
    let meta = std::fs::symlink_metadata(&confined)
        .map_err(|e| format!("Failed to stat: {e}"))?;

    if meta.is_symlink() || meta.is_file() {
        std::fs::remove_file(&confined).map_err(|e| format!("Failed to delete: {e}"))
    } else {
        std::fs::remove_dir_all(&confined)
            .map_err(|e| format!("Failed to delete directory: {e}"))
    }
}

// ── File watching (ref-counted) ──

pub fn start_watching(
    root_path: &str,
    app: &AppHandle,
    state: &FileWatcherState,
) -> Result<(), String> {
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;

    // Increment ref count if already watching
    if let Some(entry) = watchers.get_mut(root_path) {
        entry.ref_count += 1;
        return Ok(());
    }

    let root = root_path.to_string();
    let app_handle = app.clone();

    let mut debouncer = new_debouncer(
        std::time::Duration::from_millis(300),
        move |events: Result<
            Vec<notify_debouncer_mini::DebouncedEvent>,
            notify_debouncer_mini::notify::Error,
        >| {
            if let Ok(events) = events {
                let has_changes = events.iter().any(|e| e.kind == DebouncedEventKind::Any);
                if has_changes {
                    let _ = app_handle.emit("file-tree-changed", &root);
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    let watch_path = Path::new(root_path);
    debouncer
        .watcher()
        .watch(
            watch_path,
            notify_debouncer_mini::notify::RecursiveMode::Recursive,
        )
        .map_err(|e| format!("Failed to start watching: {e}"))?;

    watchers.insert(
        root_path.to_string(),
        WatcherEntry {
            debouncer,
            ref_count: 1,
        },
    );
    Ok(())
}

pub fn stop_watching(root_path: &str, state: &FileWatcherState) -> Result<(), String> {
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;

    if let Some(entry) = watchers.get_mut(root_path) {
        entry.ref_count = entry.ref_count.saturating_sub(1);
        if entry.ref_count == 0 {
            watchers.remove(root_path);
        }
    }
    Ok(())
}
