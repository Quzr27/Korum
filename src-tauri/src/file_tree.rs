use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ── Types ──

#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_ignored: bool,
    pub child_count: Option<u32>,
}

#[derive(Serialize, Clone)]
pub struct DiffLine {
    pub origin: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
    pub content: String,
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
    pub repo_root: Option<String>,
    pub statuses: Vec<GitFileStatus>,
    pub changed_count: u32,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub repo_root: String,
    pub worktree_root: String,
    pub branch: Option<String>,
    pub head_sha: Option<String>,
    pub is_detached: bool,
    pub display_name: String,
}

#[derive(Serialize, Clone)]
pub struct WorkspaceFileSearchEntry {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub is_dir: bool,
}

// ── Watcher state (with ref counting) ──

struct WatcherEntry {
    #[allow(dead_code)] // kept alive — dropped when removed from HashMap
    watcher: RecommendedWatcher,
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
const WATCHER_EXCLUDE_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "coverage",
];

/// Canonicalize `path` and verify it lives under `root`. Prevents path traversal.
/// Falls back to lexical prefix check for dangling symlinks (canonicalize fails on NotFound).
fn confine_path(path: &str, root: &str) -> Result<PathBuf, String> {
    let canonical_root =
        std::fs::canonicalize(root).map_err(|e| format!("Cannot resolve root path: {e}"))?;

    match std::fs::canonicalize(path) {
        Ok(canonical_path) => {
            if !canonical_path.starts_with(&canonical_root) {
                return Err(format!(
                    "Path escapes workspace root: {}",
                    canonical_path.display()
                ));
            }
            Ok(canonical_path)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Dangling symlink — use lexical prefix check on parent + filename
            let target = Path::new(path);
            let parent = target
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .ok_or_else(|| format!("Cannot resolve path: {e}"))?;
            let canonical_parent =
                std::fs::canonicalize(parent).map_err(|e2| format!("Cannot resolve path: {e2}"))?;
            if !canonical_parent.starts_with(&canonical_root) {
                return Err(format!(
                    "Path escapes workspace root: {}",
                    canonical_parent.display()
                ));
            }
            let file_name = target
                .file_name()
                .ok_or_else(|| format!("Cannot resolve path: {e}"))?;
            Ok(canonical_parent.join(file_name))
        }
        Err(e) => Err(format!("Cannot resolve path: {e}")),
    }
}

/// Like `confine_path` but for paths that don't exist yet (new file/dir).
/// Canonicalizes the parent and checks confinement.
fn confine_new_path(path: &str, root: &str) -> Result<PathBuf, String> {
    let target = Path::new(path);
    let parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "Cannot determine parent directory — path must be absolute".to_string())?;
    let canonical_root =
        std::fs::canonicalize(root).map_err(|e| format!("Cannot resolve root path: {e}"))?;
    let canonical_parent =
        std::fs::canonicalize(parent).map_err(|e| format!("Cannot resolve parent path: {e}"))?;

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

pub fn read_directory(path: &str, show_ignored: bool) -> Result<Vec<FileEntry>, String> {
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
        let is_ignored = gitignore.as_ref().is_some_and(|gi| {
            gi.matched_path_or_any_parents(&entry_path, is_dir)
                .is_ignore()
        });

        if is_ignored && !show_ignored {
            continue;
        }

        let child_count = if is_dir {
            count_visible_children(&entry_path)
        } else {
            None
        };

        entries.push(FileEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            is_symlink,
            is_ignored,
            child_count,
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

pub fn search_workspace_files(
    root_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceFileSearchEntry>, String> {
    let terms = normalize_search_terms(query);
    if terms.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }

    let canonical_root =
        std::fs::canonicalize(root_path).map_err(|e| format!("Cannot resolve root path: {e}"))?;
    if !canonical_root.is_dir() {
        return Err(format!("Not a directory: {root_path}"));
    }

    let mut builder = ignore::WalkBuilder::new(&canonical_root);
    builder
        .hidden(false)
        .follow_links(false)
        .filter_entry(|entry| {
            entry
                .file_name()
                .to_str()
                .is_none_or(|name| !ALWAYS_EXCLUDE.contains(&name))
        });

    let mut matches: Vec<(u32, WorkspaceFileSearchEntry)> = Vec::new();
    let max_results = limit.min(100);

    for result in builder.build() {
        let entry = match result {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let file_type = match entry.file_type() {
            Some(file_type) => file_type,
            None => continue,
        };
        if !file_type.is_file() {
            continue;
        }

        let path = entry.path();
        let relative = match path.strip_prefix(&canonical_root) {
            Ok(relative) => relative,
            Err(_) => continue,
        };
        let relative_path = relative.to_string_lossy().replace('\\', "/");
        if relative_path.is_empty() {
            continue;
        }
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| relative_path.clone());

        let haystack = format!("{} {}", name.to_lowercase(), relative_path.to_lowercase());
        if !terms.iter().all(|term| haystack.contains(term)) {
            continue;
        }

        let candidate = (
            file_search_score(&name, &relative_path, &terms),
            WorkspaceFileSearchEntry {
                name,
                path: path.to_string_lossy().to_string(),
                relative_path,
                is_dir: false,
            },
        );
        let insert_at = matches
            .binary_search_by(|existing| compare_file_search_matches(existing, &candidate))
            .unwrap_or_else(|index| index);
        if insert_at < max_results {
            matches.insert(insert_at, candidate);
            if matches.len() > max_results {
                matches.pop();
            }
        }
    }

    Ok(matches.into_iter().map(|(_, entry)| entry).collect())
}

fn compare_file_search_matches(
    a: &(u32, WorkspaceFileSearchEntry),
    b: &(u32, WorkspaceFileSearchEntry),
) -> std::cmp::Ordering {
    b.0.cmp(&a.0)
        .then_with(|| a.1.relative_path.cmp(&b.1.relative_path))
}

fn normalize_search_terms(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .map(|term| term.to_lowercase())
        .filter(|term| !term.is_empty())
        .collect()
}

fn file_search_score(name: &str, relative_path: &str, terms: &[String]) -> u32 {
    let joined = terms.join(" ");
    let name = name.to_lowercase();
    let relative_path = relative_path.to_lowercase();

    if name == joined {
        100
    } else if name.starts_with(&joined) {
        85
    } else if name.contains(&joined) {
        70
    } else if relative_path.contains(&joined) {
        55
    } else {
        40
    }
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
                repo_root: None,
                statuses: Vec::new(),
                changed_count: 0,
                insertions: 0,
                deletions: 0,
            });
        }
    };
    let repo_root = repo.workdir().map(|path| {
        std::fs::canonicalize(path)
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy()
            .into_owned()
    });

    // Single diff walk: collect both status and per-file line stats
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.include_untracked(true);
    diff_opts.recurse_untracked_dirs(true);

    let diff = repo
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))
        .map_err(|e| format!("Failed to get git diff: {e}"))?;

    // Total stats
    let (total_ins, total_del) = match diff.stats() {
        Ok(stats) => (stats.insertions() as u32, stats.deletions() as u32),
        Err(_) => (0, 0),
    };

    // Per-file stats + status via foreach.
    // All closures run synchronously on this thread. RefCell for shared mutable access.
    use std::cell::RefCell;
    let per_file: RefCell<HashMap<String, (String, u32, u32)>> = RefCell::new(HashMap::new());
    let current_file: RefCell<String> = RefCell::new(String::new());

    let _ = diff.foreach(
        &mut |delta, _| {
            if let Some(path) = delta.new_file().path().and_then(|p| p.to_str()) {
                *current_file.borrow_mut() = path.to_string();
                // Determine status from delta
                let status_char = match delta.status() {
                    git2::Delta::Added => "A",
                    git2::Delta::Deleted => "D",
                    git2::Delta::Modified => "M",
                    git2::Delta::Renamed => "R",
                    git2::Delta::Copied => "A",
                    git2::Delta::Untracked => "?",
                    _ => "M",
                };
                per_file
                    .borrow_mut()
                    .entry(path.to_string())
                    .or_insert_with(|| (status_char.to_string(), 0, 0));
            }
            true
        },
        None, // binary callback
        None, // hunk callback
        Some(&mut |_delta, _hunk, line| {
            let file = current_file.borrow().clone();
            if !file.is_empty() {
                let mut map = per_file.borrow_mut();
                if let Some(entry) = map.get_mut(&file) {
                    match line.origin() {
                        '+' => entry.1 += 1,
                        '-' => entry.2 += 1,
                        _ => {}
                    }
                }
            }
            true
        }),
    );

    let mut result: Vec<GitFileStatus> = per_file
        .into_inner()
        .into_iter()
        .map(|(path, (status, ins, del))| GitFileStatus {
            path,
            status,
            insertions: ins,
            deletions: del,
        })
        .collect();

    // Sort by path for consistent ordering
    result.sort_by(|a, b| a.path.cmp(&b.path));

    let changed_count = result.len() as u32;

    Ok(GitStatusResult {
        repo_root,
        statuses: result,
        changed_count,
        insertions: total_ins,
        deletions: total_del,
    })
}

pub fn get_git_file_status(path: &str, root: &str) -> Result<Option<GitFileStatus>, String> {
    let confined = confine_path(path, root)?;

    let repo = match git2::Repository::discover(root) {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };

    let repo_root = repo
        .workdir()
        .ok_or_else(|| "Bare repository".to_string())?;
    let repo_root_canonical =
        std::fs::canonicalize(repo_root).unwrap_or_else(|_| repo_root.to_path_buf());

    let relative = match confined.strip_prefix(&repo_root_canonical) {
        Ok(path) => path,
        Err(_) => return Ok(None),
    };
    let relative_str = relative.to_string_lossy();

    let statuses = repo
        .statuses(Some(
            git2::StatusOptions::new()
                .pathspec(&*relative_str)
                .include_untracked(true),
        ))
        .map_err(|e| format!("Failed to get file status: {e}"))?;

    let Some(entry) = statuses.iter().next() else {
        return Ok(None);
    };

    let status = entry.status();
    let status_label = if status.contains(git2::Status::INDEX_RENAMED)
        || status.contains(git2::Status::WT_RENAMED)
    {
        "R"
    } else if status.contains(git2::Status::INDEX_DELETED)
        || status.contains(git2::Status::WT_DELETED)
    {
        "D"
    } else if status.contains(git2::Status::INDEX_NEW) {
        "A"
    } else if status.contains(git2::Status::INDEX_MODIFIED)
        || status.contains(git2::Status::WT_MODIFIED)
        || status.contains(git2::Status::INDEX_TYPECHANGE)
        || status.contains(git2::Status::WT_TYPECHANGE)
    {
        "M"
    } else {
        return Ok(None);
    };

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.pathspec(&*relative_str);
    let (insertions, deletions) = repo
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))
        .ok()
        .and_then(|diff| diff.stats().ok())
        .map(|stats| (stats.insertions() as u32, stats.deletions() as u32))
        .unwrap_or((0, 0));

    Ok(Some(GitFileStatus {
        path: relative_str.to_string(),
        status: status_label.to_string(),
        insertions,
        deletions,
    }))
}

pub fn get_worktree_info(path: &str) -> Result<Option<WorktreeInfo>, String> {
    let repo = match git2::Repository::discover(path) {
        Ok(repo) => repo,
        Err(_) => return Ok(None),
    };

    let Some(workdir) = repo.workdir() else {
        return Ok(None);
    };

    let worktree_root = std::fs::canonicalize(workdir).unwrap_or_else(|_| workdir.to_path_buf());
    let repo_root = repo_root_for_worktree_info(&repo, &worktree_root);

    let head = match repo.head() {
        Ok(head) => head,
        Err(_) => {
            let fallback = worktree_root
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("worktree")
                .to_string();
            return Ok(Some(WorktreeInfo {
                repo_root: repo_root.to_string_lossy().to_string(),
                worktree_root: worktree_root.to_string_lossy().to_string(),
                branch: None,
                head_sha: None,
                is_detached: false,
                display_name: fallback,
            }));
        }
    };

    let branch = if head.is_branch() {
        head.shorthand().map(ToOwned::to_owned)
    } else {
        None
    };
    let head_sha = head
        .target()
        .or_else(|| head.target_peel())
        .map(|oid| oid.to_string().chars().take(7).collect::<String>());
    let is_detached = branch.is_none() && head_sha.is_some();
    let display_name = branch
        .clone()
        .or_else(|| head_sha.clone())
        .or_else(|| {
            worktree_root
                .file_name()
                .and_then(|name| name.to_str())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "worktree".to_string());

    Ok(Some(WorktreeInfo {
        repo_root: repo_root.to_string_lossy().to_string(),
        worktree_root: worktree_root.to_string_lossy().to_string(),
        branch,
        head_sha,
        is_detached,
        display_name,
    }))
}

fn repo_root_for_worktree_info(repo: &git2::Repository, worktree_root: &Path) -> PathBuf {
    if repo.is_worktree() {
        if let Some(common_git_dir) = common_git_dir_for_linked_worktree(repo.path()) {
            if let Some(root) = common_git_dir.parent() {
                return std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
            }
        }
        return worktree_root.to_path_buf();
    }

    repo.path()
        .parent()
        .map(|path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()))
        .unwrap_or_else(|| worktree_root.to_path_buf())
}

fn common_git_dir_for_linked_worktree(git_dir: &Path) -> Option<PathBuf> {
    let common_dir = std::fs::read_to_string(git_dir.join("commondir")).ok()?;
    let common_dir = common_dir.lines().next()?.trim();
    if common_dir.is_empty() {
        return None;
    }

    let path = PathBuf::from(common_dir);
    let common_git_dir = if path.is_absolute() {
        path
    } else {
        git_dir.join(path)
    };
    Some(std::fs::canonicalize(&common_git_dir).unwrap_or(common_git_dir))
}

/// Count visible (non-excluded) children of a directory.
/// Uses a lightweight count — skips hardcoded excludes but does NOT rebuild
/// the full gitignore chain per child (too expensive for a cosmetic badge).
fn count_visible_children(dir_path: &Path) -> Option<u32> {
    let read_dir = std::fs::read_dir(dir_path).ok()?;
    let mut count: u32 = 0;

    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if ALWAYS_EXCLUDE.contains(&name.as_str()) {
            continue;
        }
        count += 1;
    }

    Some(count)
}

// ── File content ──

const MAX_FILE_SIZE: u64 = 51_200; // 50 KB — opened as NoteWindow, persisted in state.json
const MAX_CODE_FILE_SIZE: u64 = 512_000; // 500 KB — CodeWindow, not persisted in state.json

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

pub fn read_code_file_content(path: &str) -> Result<String, String> {
    use std::io::Read as _;

    let file_path = Path::new(path);
    if !file_path.is_file() {
        return Err(format!("Not a file: {path}"));
    }

    let metadata =
        std::fs::metadata(file_path).map_err(|e| format!("Failed to read metadata: {e}"))?;
    if metadata.len() > MAX_CODE_FILE_SIZE {
        return Err(format!(
            "File too large ({} bytes, max {} bytes)",
            metadata.len(),
            MAX_CODE_FILE_SIZE
        ));
    }

    // Bounded read — cap actual bytes read regardless of concurrent file growth
    let file = std::fs::File::open(file_path).map_err(|e| format!("Failed to open file: {e}"))?;
    let mut raw = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_CODE_FILE_SIZE + 1)
        .read_to_end(&mut raw)
        .map_err(|e| format!("Failed to read file: {e}"))?;

    if raw.len() as u64 > MAX_CODE_FILE_SIZE {
        return Err(format!(
            "File too large ({} bytes, max {} bytes)",
            raw.len(),
            MAX_CODE_FILE_SIZE
        ));
    }

    // Binary detection
    if raw.iter().take(8192).any(|&b| b == 0) {
        return Err("Binary file".to_string());
    }

    String::from_utf8(raw).map_err(|_| "Non-UTF-8 file".to_string())
}

// ── File diff ──

pub fn get_file_diff(path: &str, root: &str) -> Result<Vec<DiffLine>, String> {
    let confined = confine_path(path, root)?;

    let repo = match git2::Repository::discover(root) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };

    let repo_root = repo
        .workdir()
        .ok_or_else(|| "Bare repository".to_string())?;

    let repo_root_canonical =
        std::fs::canonicalize(repo_root).unwrap_or_else(|_| repo_root.to_path_buf());

    let relative = confined
        .strip_prefix(&repo_root_canonical)
        .map_err(|_| "File not in repository".to_string())?;
    let relative_str = relative.to_string_lossy();

    // Check if file is untracked
    let statuses = repo
        .statuses(Some(
            git2::StatusOptions::new()
                .pathspec(&*relative_str)
                .include_untracked(true),
        ))
        .map_err(|e| format!("Failed to get status: {e}"))?;

    let is_untracked = statuses
        .iter()
        .any(|e| e.status().contains(git2::Status::WT_NEW));

    // For untracked files, return all lines as "add" (with size/binary guards)
    if is_untracked {
        let meta =
            std::fs::metadata(&confined).map_err(|e| format!("Failed to read metadata: {e}"))?;
        if meta.len() > MAX_CODE_FILE_SIZE {
            return Err(format!("File too large for diff ({} bytes)", meta.len()));
        }
        let raw = std::fs::read(&confined).map_err(|e| format!("Failed to read file: {e}"))?;
        if raw.iter().take(8192).any(|&b| b == 0) {
            return Err("Binary file".to_string());
        }
        let content = String::from_utf8(raw).map_err(|_| "Non-UTF-8 file".to_string())?;
        return Ok(content
            .lines()
            .enumerate()
            .map(|(i, line)| DiffLine {
                origin: "add".to_string(),
                old_lineno: None,
                new_lineno: Some(i as u32 + 1),
                content: line.to_string(),
            })
            .collect());
    }

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.pathspec(&*relative_str);

    let diff = repo
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))
        .map_err(|e| format!("Failed to compute diff: {e}"))?;

    // All foreach callbacks are synchronous on this thread — plain Vec is sufficient.
    let mut lines = Vec::<DiffLine>::new();

    let _ = diff.foreach(
        &mut |_delta, _| true,
        None,
        None,
        Some(&mut |_delta, _hunk, line| {
            let origin = match line.origin() {
                '+' => "add",
                '-' => "delete",
                ' ' => "context",
                _ => return true,
            };
            let content = std::str::from_utf8(line.content())
                .unwrap_or("")
                .trim_end_matches('\n')
                .trim_end_matches('\r')
                .to_string();

            lines.push(DiffLine {
                origin: origin.to_string(),
                old_lineno: line.old_lineno(),
                new_lineno: line.new_lineno(),
                content,
            });
            true
        }),
    );

    Ok(lines)
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
    if confined_new.exists() {
        return Err(format!(
            "A file or directory already exists at: {}",
            confined_new.display()
        ));
    }
    std::fs::rename(&confined_old, &confined_new).map_err(|e| format!("Failed to rename: {e}"))
}

pub fn delete_path(path: &str, root: &str) -> Result<(), String> {
    let confined = confine_path(path, root)?;

    // Use symlink_metadata — don't follow symlinks into directories outside workspace
    let meta = std::fs::symlink_metadata(&confined).map_err(|e| format!("Failed to stat: {e}"))?;

    if meta.is_symlink() || meta.is_file() {
        std::fs::remove_file(&confined).map_err(|e| format!("Failed to delete: {e}"))
    } else {
        std::fs::remove_dir_all(&confined).map_err(|e| format!("Failed to delete directory: {e}"))
    }
}

// ── File watching (ref-counted) ──

fn should_emit_watcher_event(root: &Path, event_path: &Path) -> bool {
    let Ok(relative_path) = event_path.strip_prefix(root) else {
        return true;
    };

    !relative_path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| WATCHER_EXCLUDE_DIRS.contains(&name))
    })
}

pub fn start_watching(
    root_path: &str,
    app: &AppHandle,
    state: &FileWatcherState,
) -> Result<(), String> {
    // Fast path: if already watching, just bump ref count (lock held briefly).
    {
        let mut watchers = state
            .watchers
            .lock()
            .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
        if let Some(entry) = watchers.get_mut(root_path) {
            entry.ref_count += 1;
            return Ok(());
        }
    }

    // Build and start the watcher BEFORE re-acquiring the lock so that the
    // blocking `watch()` syscall never holds the HashMap mutex. Without this,
    // a concurrent `stop_watching` would deadlock.
    let root = root_path.to_string();
    let app_handle = app.clone();
    let callback_root = root.clone();
    // Filter generated/dependency paths before they enter any debounce queue.
    // The bounded channel stores at most one dirty signal regardless of build
    // churn; a worker turns it into one trailing event after 100 ms of quiet.
    let (change_tx, change_rx) = mpsc::sync_channel::<()>(1);
    std::thread::spawn(move || loop {
        if change_rx.recv().is_err() {
            return;
        }
        loop {
            match change_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(()) => continue,
                Err(RecvTimeoutError::Timeout) => {
                    let _ = app_handle.emit("file-tree-changed", &root);
                    break;
                }
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    });

    let mut watcher = RecommendedWatcher::new(
        move |event: Result<notify::Event, notify::Error>| {
            if event.is_ok_and(|event| {
                event
                    .paths
                    .iter()
                    .any(|path| should_emit_watcher_event(Path::new(&callback_root), path))
            }) {
                let _ = change_tx.try_send(());
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(Path::new(root_path), RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to start watching: {e}"))?;

    // Insert into the map now that the watcher is running.
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|e: std::sync::PoisonError<_>| e.to_string())?;

    // Another thread may have inserted while we were setting up — check again.
    // If so, the watcher we just created will be dropped (and unwatch itself).
    if let Some(entry) = watchers.get_mut(root_path) {
        entry.ref_count += 1;
    } else {
        watchers.insert(
            root_path.to_string(),
            WatcherEntry {
                watcher,
                ref_count: 1,
            },
        );
    }
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

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Create a unique temporary directory for each test run.
    fn make_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos();
        let dir = std::env::temp_dir().join(format!("korum_test_{}_{}", prefix, nanos));
        fs::create_dir_all(&dir).expect("failed to create temp dir");
        dir
    }

    #[test]
    fn watcher_events_ignore_generated_and_dependency_trees() {
        let root = Path::new("/workspace/project");
        for relative_path in [
            ".git/index",
            "node_modules/pkg/index.js",
            "src-tauri/target/debug/korum",
            "dist/assets/index.js",
            "build/output.js",
            "apps/web/.next/cache/data",
            "coverage/lcov.info",
        ] {
            assert!(
                !should_emit_watcher_event(root, &root.join(relative_path)),
                "expected watcher event under {relative_path} to be ignored"
            );
        }
    }

    #[test]
    fn watcher_events_keep_source_and_similarly_named_paths() {
        let root = Path::new("/workspace/project");
        for relative_path in [
            "src/App.tsx",
            "src/targeted.rs",
            "builder/output.ts",
            ".gitignore",
        ] {
            assert!(
                should_emit_watcher_event(root, &root.join(relative_path)),
                "expected watcher event for {relative_path} to be emitted"
            );
        }
    }

    // ── confine_path ──────────────────────────────────────────────────────────

    /// Valid path inside root → Ok, resolved path returned.
    #[test]
    fn confine_path_valid_inside_root() {
        let root = make_temp_dir("cp_valid");
        let file = root.join("hello.txt");
        fs::write(&file, b"").expect("write");

        let result = confine_path(&file.to_string_lossy(), &root.to_string_lossy());
        assert!(result.is_ok(), "expected Ok, got {:?}", result);
        let resolved = result.unwrap();
        // The resolved path must still live under root.
        let canonical_root = fs::canonicalize(&root).unwrap();
        assert!(resolved.starts_with(&canonical_root));

        fs::remove_dir_all(&root).ok();
    }

    /// Path traversal (`root + "/../../../etc/passwd"`) → Err.
    #[test]
    fn confine_path_traversal_rejected() {
        let root = make_temp_dir("cp_traversal");

        // Construct a path that exits the root via "..".
        // /tmp/korum_test_cp_traversal_XXXXX/../../some_file
        // After canonicalization this lands outside root.
        let escape = root.join("..").join("..").join("etc").join("passwd");

        let result = confine_path(&escape.to_string_lossy(), &root.to_string_lossy());
        // Should either be Err (path resolved outside root) or, on systems
        // where /etc/passwd doesn't exist, still Err via the dangling-symlink
        // branch (parent ".." won't start with root).
        assert!(result.is_err(), "expected Err for traversal, got Ok");

        fs::remove_dir_all(&root).ok();
    }

    /// Exact root path → Ok.
    #[test]
    fn confine_path_exact_root() {
        let root = make_temp_dir("cp_root");

        let result = confine_path(&root.to_string_lossy(), &root.to_string_lossy());
        assert!(
            result.is_ok(),
            "expected Ok for root itself, got {:?}",
            result
        );

        fs::remove_dir_all(&root).ok();
    }

    /// Nested subdirectory → Ok.
    #[test]
    fn confine_path_nested_subdir() {
        let root = make_temp_dir("cp_nested");
        let sub = root.join("a").join("b").join("c");
        fs::create_dir_all(&sub).expect("create_dir_all");
        let file = sub.join("deep.rs");
        fs::write(&file, b"").expect("write");

        let result = confine_path(&file.to_string_lossy(), &root.to_string_lossy());
        assert!(
            result.is_ok(),
            "expected Ok for nested file, got {:?}",
            result
        );

        fs::remove_dir_all(&root).ok();
    }

    /// Non-existent file with existing parent (dangling symlink fallback) → Ok.
    #[test]
    fn confine_path_nonexistent_file_existing_parent() {
        let root = make_temp_dir("cp_dangling");
        // The parent exists (root itself), but the file does not.
        let ghost = root.join("ghost_file.txt");
        // Make sure it really does not exist.
        assert!(!ghost.exists());

        let result = confine_path(&ghost.to_string_lossy(), &root.to_string_lossy());
        assert!(
            result.is_ok(),
            "expected Ok via dangling-symlink fallback, got {:?}",
            result
        );
        // Returned path should be parent (root) + filename.
        let resolved = result.unwrap();
        assert_eq!(resolved.file_name().unwrap(), "ghost_file.txt");
        let canonical_root = fs::canonicalize(&root).unwrap();
        assert!(resolved.starts_with(&canonical_root));

        fs::remove_dir_all(&root).ok();
    }

    /// Non-existent path where parent also doesn't exist → Err.
    #[test]
    fn confine_path_nonexistent_parent_is_err() {
        let root = make_temp_dir("cp_no_parent");
        // The parent directory does not exist either.
        let deep_ghost = root.join("no_such_dir").join("also_missing.txt");

        let result = confine_path(&deep_ghost.to_string_lossy(), &root.to_string_lossy());
        assert!(
            result.is_err(),
            "expected Err when parent also missing, got Ok"
        );

        fs::remove_dir_all(&root).ok();
    }

    // ── confine_new_path ──────────────────────────────────────────────────────

    /// New file directly in root → Ok.
    #[test]
    fn confine_new_path_file_in_root() {
        let root = make_temp_dir("cnp_root");

        let new_file = root.join("newfile.txt");
        let result = confine_new_path(&new_file.to_string_lossy(), &root.to_string_lossy());
        assert!(result.is_ok(), "expected Ok, got {:?}", result);

        fs::remove_dir_all(&root).ok();
    }

    /// New file in an existing subdirectory → Ok.
    #[test]
    fn confine_new_path_file_in_subdir() {
        let root = make_temp_dir("cnp_sub");
        let sub = root.join("subdir");
        fs::create_dir_all(&sub).expect("create subdir");

        let new_file = sub.join("new.rs");
        let result = confine_new_path(&new_file.to_string_lossy(), &root.to_string_lossy());
        assert!(
            result.is_ok(),
            "expected Ok for new file in subdir, got {:?}",
            result
        );

        fs::remove_dir_all(&root).ok();
    }

    /// Path whose parent escapes root → Err.
    #[test]
    fn confine_new_path_escaping_root_is_err() {
        let root = make_temp_dir("cnp_escape");
        // Create a sibling dir that actually exists so canonicalize works.
        let sibling = root.parent().unwrap().join(format!(
            "korum_sibling_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos()
        ));
        fs::create_dir_all(&sibling).expect("create sibling");

        let escape = sibling.join("malicious.sh");
        let result = confine_new_path(&escape.to_string_lossy(), &root.to_string_lossy());
        assert!(
            result.is_err(),
            "expected Err for path escaping root, got Ok"
        );

        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&sibling).ok();
    }

    /// Bare filename (no parent component) → Err.
    #[test]
    fn confine_new_path_bare_filename_is_err() {
        let root = make_temp_dir("cnp_bare");

        // "just_a_name.txt" has no parent dir component — parent() returns ""
        let result = confine_new_path("just_a_name.txt", &root.to_string_lossy());
        assert!(result.is_err(), "expected Err for bare filename, got Ok");

        fs::remove_dir_all(&root).ok();
    }

    // ── read_directory ────────────────────────────────────────────────────────

    /// Basic reading — created files and dirs appear in result.
    #[test]
    fn read_directory_basic() {
        let root = make_temp_dir("rd_basic");
        fs::write(root.join("file_a.txt"), b"").expect("write a");
        fs::write(root.join("file_b.rs"), b"").expect("write b");
        fs::create_dir(root.join("subdir")).expect("mkdir");

        let entries =
            read_directory(&root.to_string_lossy(), false).expect("read_directory failed");

        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"file_a.txt"), "file_a.txt missing");
        assert!(names.contains(&"file_b.rs"), "file_b.rs missing");
        assert!(names.contains(&"subdir"), "subdir missing");

        fs::remove_dir_all(&root).ok();
    }

    /// Directories appear before files (dirs-first sort).
    #[test]
    fn read_directory_dirs_first() {
        let root = make_temp_dir("rd_sort");
        fs::write(root.join("aaa.txt"), b"").expect("write file");
        fs::create_dir(root.join("zzz_dir")).expect("mkdir");

        let entries =
            read_directory(&root.to_string_lossy(), false).expect("read_directory failed");

        assert!(!entries.is_empty());
        assert!(entries[0].is_dir, "first entry should be a directory");

        fs::remove_dir_all(&root).ok();
    }

    /// Hardcoded excludes (.git, .DS_Store, Thumbs.db) are filtered out.
    #[test]
    fn read_directory_excludes_hardcoded() {
        let root = make_temp_dir("rd_excl");
        fs::create_dir(root.join(".git")).expect("mkdir .git");
        fs::write(root.join(".DS_Store"), b"").expect("write .DS_Store");
        fs::write(root.join("Thumbs.db"), b"").expect("write Thumbs.db");
        fs::write(root.join("visible.txt"), b"").expect("write visible");

        let entries =
            read_directory(&root.to_string_lossy(), false).expect("read_directory failed");

        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(!names.contains(&".git"), ".git should be excluded");
        assert!(
            !names.contains(&".DS_Store"),
            ".DS_Store should be excluded"
        );
        assert!(
            !names.contains(&"Thumbs.db"),
            "Thumbs.db should be excluded"
        );
        assert!(names.contains(&"visible.txt"), "visible.txt should appear");

        fs::remove_dir_all(&root).ok();
    }

    /// Without a .gitignore, all entries have is_ignored=false.
    #[test]
    fn read_directory_no_gitignore_nothing_ignored() {
        let root = make_temp_dir("rd_no_gi");
        fs::write(root.join("normal.txt"), b"").expect("write");

        let entries =
            read_directory(&root.to_string_lossy(), false).expect("read_directory failed");

        for entry in &entries {
            assert!(
                !entry.is_ignored,
                "entry '{}' should not be ignored without a .gitignore",
                entry.name
            );
        }

        fs::remove_dir_all(&root).ok();
    }

    /// Helper: create a minimal fake git repo with .git dir + .gitignore.
    fn make_git_root(name: &str, gitignore_content: &str) -> PathBuf {
        let root = make_temp_dir(name);
        fs::create_dir(root.join(".git")).expect("mkdir .git");
        fs::write(root.join(".gitignore"), gitignore_content).expect("write .gitignore");
        root
    }

    fn init_git_repo_with_file(
        name: &str,
        relative_path: &str,
        content: &str,
    ) -> (PathBuf, git2::Repository) {
        let root = make_temp_dir(name);
        let repo = git2::Repository::init(&root).expect("init repository");
        let file_path = root.join(relative_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("create parent directory");
        }
        fs::write(&file_path, content).expect("write initial file");

        let mut index = repo.index().expect("open index");
        index
            .add_path(Path::new(relative_path))
            .expect("add file to index");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        drop(index);

        let tree = repo.find_tree(tree_id).expect("find tree");
        let signature =
            git2::Signature::now("Korum Test", "korum-test@example.com").expect("signature");
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "Initial commit",
            &tree,
            &[],
        )
        .expect("commit");
        drop(tree);

        (root, repo)
    }

    #[test]
    fn get_git_file_status_reports_modified_tracked_file() {
        let (root, repo) = init_git_repo_with_file("gfs_modified", "src/app.rs", "fn main() {}\n");
        let file_path = root.join("src/app.rs");
        fs::write(&file_path, "fn main() {\n    println!(\"hi\");\n}\n").expect("modify file");

        let status = get_git_file_status(&file_path.to_string_lossy(), &root.to_string_lossy())
            .expect("status lookup")
            .expect("modified status");

        assert_eq!(status.path, "src/app.rs");
        assert_eq!(status.status, "M");

        drop(repo);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn get_git_file_status_returns_none_for_untracked_file() {
        let (root, repo) = init_git_repo_with_file("gfs_untracked", "src/app.rs", "fn main() {}\n");
        let file_path = root.join("scratch.rs");
        fs::write(&file_path, "temporary\n").expect("write untracked file");

        let status = get_git_file_status(&file_path.to_string_lossy(), &root.to_string_lossy())
            .expect("status lookup");

        assert!(status.is_none());

        drop(repo);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn get_git_file_status_returns_none_for_clean_file() {
        let (root, repo) = init_git_repo_with_file("gfs_clean", "src/app.rs", "fn main() {}\n");
        let file_path = root.join("src/app.rs");

        let status = get_git_file_status(&file_path.to_string_lossy(), &root.to_string_lossy())
            .expect("status lookup");

        assert!(status.is_none());

        drop(repo);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn get_git_status_includes_repo_root_for_subdirectory_root() {
        let (root, repo) = init_git_repo_with_file("gs_repo_root", "src/app.rs", "fn main() {}\n");
        let file_path = root.join("src/app.rs");
        fs::write(&file_path, "fn main() {\n    println!(\"hi\");\n}\n").expect("modify file");

        let status = get_git_status(&root.join("src").to_string_lossy()).expect("git status");

        assert_eq!(
            status.repo_root,
            Some(
                fs::canonicalize(&root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            )
        );
        assert_eq!(status.statuses.len(), 1);
        assert_eq!(status.statuses[0].path, "src/app.rs");

        drop(repo);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn get_file_diff_returns_deleted_rows_for_deleted_file() {
        let (root, repo) = init_git_repo_with_file("gfd_deleted", "src/app.rs", "fn main() {}\n");
        let file_path = root.join("src/app.rs");
        fs::remove_file(&file_path).expect("delete file");

        let diff = get_file_diff(&file_path.to_string_lossy(), &root.to_string_lossy())
            .expect("deleted file diff");

        assert!(diff
            .iter()
            .any(|line| line.origin == "delete" && line.content == "fn main() {}"));

        drop(repo);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn get_worktree_info_reports_current_branch() {
        let (root, repo) = init_git_repo_with_file("wti_branch", "src/app.rs", "fn main() {}\n");
        let commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature/worktree-ui", &commit, true)
            .expect("create branch");
        drop(commit);
        repo.set_head("refs/heads/feature/worktree-ui")
            .expect("set head");

        let info = get_worktree_info(&root.to_string_lossy())
            .expect("worktree info")
            .expect("git repo");

        assert_eq!(
            PathBuf::from(&info.worktree_root),
            fs::canonicalize(&root).unwrap()
        );
        assert_eq!(
            PathBuf::from(&info.repo_root),
            fs::canonicalize(&root).unwrap()
        );
        assert_eq!(info.branch.as_deref(), Some("feature/worktree-ui"));
        assert!(!info.is_detached);
        assert_eq!(info.display_name, "feature/worktree-ui");
        assert_eq!(info.head_sha.as_deref().map(str::len), Some(7));

        drop(repo);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn get_worktree_info_handles_detached_head() {
        let (root, repo) = init_git_repo_with_file("wti_detached", "src/app.rs", "fn main() {}\n");
        let commit = repo.head().unwrap().peel_to_commit().unwrap();
        let short = commit.id().to_string()[..7].to_string();
        repo.set_head_detached(commit.id()).expect("detach head");
        drop(commit);

        let info = get_worktree_info(&root.to_string_lossy())
            .expect("worktree info")
            .expect("git repo");

        assert_eq!(info.branch, None);
        assert!(info.is_detached);
        assert_eq!(info.head_sha.as_deref(), Some(short.as_str()));
        assert_eq!(info.display_name, short);

        drop(repo);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn get_worktree_info_accepts_file_paths_inside_repo() {
        let (root, repo) = init_git_repo_with_file("wti_file_path", "src/app.rs", "fn main() {}\n");
        let file_path = root.join("src/app.rs");

        let info = get_worktree_info(&file_path.to_string_lossy())
            .expect("worktree info")
            .expect("git repo");

        assert_eq!(
            PathBuf::from(&info.worktree_root),
            fs::canonicalize(&root).unwrap()
        );
        assert_eq!(info.branch.as_deref(), Some("master"));

        drop(repo);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn get_worktree_info_reports_common_repo_root_for_linked_worktrees() {
        let (root, repo) =
            init_git_repo_with_file("wti_linked_main", "src/app.rs", "fn main() {}\n");
        let linked_root = root.with_file_name(format!(
            "{}-linked",
            root.file_name().and_then(|name| name.to_str()).unwrap()
        ));
        let commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature/linked-worktree", &commit, true)
            .expect("create linked branch");
        drop(commit);
        let reference = repo
            .find_reference("refs/heads/feature/linked-worktree")
            .expect("find linked branch");
        let mut options = git2::WorktreeAddOptions::new();
        options.reference(Some(&reference));
        let worktree = repo
            .worktree("linked-worktree", &linked_root, Some(&options))
            .expect("create linked worktree");

        let info = get_worktree_info(&linked_root.to_string_lossy())
            .expect("worktree info")
            .expect("git repo");

        assert_eq!(
            PathBuf::from(&info.worktree_root),
            fs::canonicalize(&linked_root).unwrap()
        );
        assert_eq!(
            PathBuf::from(&info.repo_root),
            fs::canonicalize(&root).unwrap()
        );
        assert_eq!(info.branch.as_deref(), Some("feature/linked-worktree"));

        drop(worktree);
        drop(reference);
        drop(repo);
        fs::remove_dir_all(&linked_root).ok();
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn get_worktree_info_returns_none_outside_git() {
        let root = make_temp_dir("wti_none");

        let info = get_worktree_info(&root.to_string_lossy()).expect("lookup");

        assert!(info.is_none());
        fs::remove_dir_all(&root).ok();
    }

    /// show_ignored=false: gitignored files are excluded from results.
    #[test]
    fn read_directory_gitignore_filters_ignored() {
        let root = make_git_root("rd_gi_filter", "*.log\nbuild/\n");
        fs::write(root.join("app.rs"), b"fn main() {}").expect("write app.rs");
        fs::write(root.join("debug.log"), b"trace").expect("write debug.log");
        fs::create_dir(root.join("build")).expect("mkdir build");
        fs::write(root.join("build").join("out.js"), b"").expect("write out.js");

        let entries =
            read_directory(&root.to_string_lossy(), false).expect("read_directory failed");
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        assert!(names.contains(&"app.rs"), "app.rs should appear");
        assert!(
            !names.contains(&"debug.log"),
            "debug.log should be filtered by *.log"
        );
        assert!(
            !names.contains(&"build"),
            "build/ should be filtered by build/"
        );

        fs::remove_dir_all(&root).ok();
    }

    /// show_ignored=true: gitignored files appear with is_ignored=true.
    #[test]
    fn read_directory_show_ignored_includes_with_flag() {
        let root = make_git_root("rd_gi_show", "*.log\n");
        fs::write(root.join("app.rs"), b"").expect("write app.rs");
        fs::write(root.join("debug.log"), b"").expect("write debug.log");

        let entries = read_directory(&root.to_string_lossy(), true).expect("read_directory failed");
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        assert!(names.contains(&"app.rs"), "app.rs should appear");
        assert!(
            names.contains(&"debug.log"),
            "debug.log should appear with show_ignored=true"
        );

        let log_entry = entries.iter().find(|e| e.name == "debug.log").unwrap();
        assert!(
            log_entry.is_ignored,
            "debug.log should have is_ignored=true"
        );

        let rs_entry = entries.iter().find(|e| e.name == "app.rs").unwrap();
        assert!(!rs_entry.is_ignored, "app.rs should have is_ignored=false");

        fs::remove_dir_all(&root).ok();
    }

    /// Gitignore patterns match directories correctly.
    #[test]
    fn read_directory_gitignore_dir_pattern() {
        let root = make_git_root("rd_gi_dir", "node_modules/\n");
        fs::create_dir(root.join("node_modules")).expect("mkdir node_modules");
        fs::create_dir(root.join("src")).expect("mkdir src");

        let entries =
            read_directory(&root.to_string_lossy(), false).expect("read_directory failed");
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        assert!(names.contains(&"src"), "src should appear");
        assert!(
            !names.contains(&"node_modules"),
            "node_modules/ should be filtered"
        );

        fs::remove_dir_all(&root).ok();
    }

    // ── search_workspace_files ────────────────────────────────────────────────

    #[test]
    fn search_workspace_files_matches_names_and_relative_paths() {
        let root = make_temp_dir("swf_match");
        fs::create_dir_all(root.join("src/components")).expect("mkdir components");
        fs::write(root.join("src/App.tsx"), b"export default function App() {}\n")
            .expect("write app");
        fs::write(root.join("src/components/CommandCenter.tsx"), b"").expect("write command center");
        fs::write(root.join("README.md"), b"Command center docs\n").expect("write readme");

        let app_results =
            search_workspace_files(&root.to_string_lossy(), "app", 20).expect("search app");
        assert_eq!(app_results.len(), 1);
        assert_eq!(app_results[0].name, "App.tsx");
        assert_eq!(app_results[0].relative_path, "src/App.tsx");
        assert!(!app_results[0].is_dir);

        let path_results =
            search_workspace_files(&root.to_string_lossy(), "components command", 20)
                .expect("search path fragments");
        assert_eq!(path_results.len(), 1);
        assert_eq!(
            path_results[0].relative_path,
            "src/components/CommandCenter.tsx"
        );

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn search_workspace_files_respects_gitignore_and_hard_excludes() {
        let root = make_git_root("swf_ignore", "dist/\n*.log\n");
        fs::create_dir_all(root.join("dist")).expect("mkdir dist");
        fs::write(root.join("dist/generated.ts"), b"").expect("write generated");
        fs::write(root.join("debug.log"), b"").expect("write log");
        fs::create_dir(root.join(".git").join("objects")).expect("mkdir .git objects");
        fs::write(root.join(".git").join("config"), b"").expect("write git config");
        fs::write(root.join("visible.ts"), b"").expect("write visible");

        let results =
            search_workspace_files(&root.to_string_lossy(), "ts", 20).expect("search files");
        let paths: Vec<&str> = results
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect();

        assert_eq!(paths, vec!["visible.ts"]);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn search_workspace_files_clamps_empty_queries_and_limits_results() {
        let root = make_temp_dir("swf_limit");
        for index in 0..5 {
            fs::write(root.join(format!("match-{index}.ts")), b"").expect("write file");
        }

        let empty = search_workspace_files(&root.to_string_lossy(), "  ", 20)
            .expect("search empty query");
        assert!(empty.is_empty());

        let limited = search_workspace_files(&root.to_string_lossy(), "match", 2)
            .expect("search limited");
        assert_eq!(limited.len(), 2);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn search_workspace_files_keeps_best_matches_when_limited() {
        let root = make_temp_dir("swf_top_k");
        fs::create_dir_all(root.join("docs")).expect("mkdir docs");
        fs::write(root.join("docs/readme-app.md"), b"").expect("write readme app");
        fs::write(root.join("app.tsx"), b"").expect("write app");

        let results =
            search_workspace_files(&root.to_string_lossy(), "app", 1).expect("search top k");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, "app.tsx");

        fs::remove_dir_all(&root).ok();
    }
}
