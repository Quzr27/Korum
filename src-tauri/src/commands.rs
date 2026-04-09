use crate::file_tree::FileWatcherState;
use crate::pty::PtyState;
use crate::quit_guard::QuitGuardState;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

#[derive(Serialize)]
pub struct TerminalInfo {
    pub id: String,
}

#[tauri::command]
pub fn create_terminal(
    state: State<'_, PtyState>,
    cwd: Option<String>,
) -> Result<TerminalInfo, String> {
    let shell = get_default_shell();
    let id = state.spawn(&shell, cwd.as_deref(), 24, 80)?;
    Ok(TerminalInfo { id })
}

#[tauri::command]
pub fn attach_terminal(
    state: State<'_, PtyState>,
    id: String,
    output_channel: Channel<Vec<u8>>,
) -> Result<(), String> {
    state.attach(&id, output_channel)
}

#[tauri::command]
pub fn detach_terminal(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    state.detach(&id)
}

#[tauri::command]
pub fn write_terminal(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    state.write(&id, data.as_bytes())
}

#[tauri::command]
pub fn resize_terminal(
    state: State<'_, PtyState>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    if rows == 0 || cols == 0 {
        return Err("Invalid dimensions".to_string());
    }
    state.resize(&id, rows, cols)
}

#[tauri::command]
pub fn kill_terminal(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    state.kill(&id)
}

// ── Shell detection ──

fn get_default_shell() -> String {
    if let Ok(shell) = std::env::var("SHELL") {
        if !shell.is_empty() && shell.starts_with('/') {
            return shell;
        }
    }
    // Fallback chain: macOS → Linux → last resort
    for candidate in &["/bin/zsh", "/bin/bash", "/bin/sh"] {
        if std::path::Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    "/bin/sh".to_string()
}

// ── Claude usage ──

#[tauri::command]
pub async fn fetch_claude_usage() -> Result<crate::claude_usage::UsageResponse, String> {
    crate::claude_usage::fetch_usage().await
}

#[tauri::command]
pub async fn fetch_codex_usage() -> Result<crate::codex_usage::CodexUsageResponse, String> {
    crate::codex_usage::fetch_usage().await
}

// ── Storage commands ──

#[tauri::command]
pub fn save_state(app: tauri::AppHandle, state: serde_json::Value) -> Result<(), String> {
    crate::storage::save_state(&app, &state)
}

#[tauri::command]
pub fn load_state(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    crate::storage::load_state(&app)
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: serde_json::Value) -> Result<(), String> {
    crate::storage::save_settings(&app, &settings)
}

#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    crate::storage::load_settings(&app)
}

#[tauri::command]
pub fn confirm_app_exit(
    app: tauri::AppHandle,
    quit_guard: State<'_, QuitGuardState>,
) -> Result<(), String> {
    quit_guard.allow_next_exit();
    app.exit(0);
    Ok(())
}

// ── File tree commands ──

#[tauri::command]
pub fn read_directory(path: String) -> Result<Vec<crate::file_tree::FileEntry>, String> {
    crate::file_tree::read_directory(&path)
}

#[tauri::command]
pub fn get_git_status(root_path: String) -> Result<crate::file_tree::GitStatusResult, String> {
    crate::file_tree::get_git_status(&root_path)
}

#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, String> {
    crate::file_tree::read_file_content(&path)
}

#[tauri::command]
pub fn create_file(path: String, root: String) -> Result<(), String> {
    crate::file_tree::create_file(&path, &root)
}

#[tauri::command]
pub fn create_directory(path: String, root: String) -> Result<(), String> {
    crate::file_tree::create_directory(&path, &root)
}

#[tauri::command]
pub fn rename_path(old_path: String, new_path: String, root: String) -> Result<(), String> {
    crate::file_tree::rename_path(&old_path, &new_path, &root)
}

#[tauri::command]
pub fn delete_path(path: String, root: String) -> Result<(), String> {
    crate::file_tree::delete_path(&path, &root)
}

#[tauri::command]
pub fn start_watching(
    app: tauri::AppHandle,
    state: State<'_, FileWatcherState>,
    root_path: String,
) -> Result<(), String> {
    crate::file_tree::start_watching(&root_path, &app, &state)
}

#[tauri::command]
pub fn stop_watching(
    state: State<'_, FileWatcherState>,
    root_path: String,
) -> Result<(), String> {
    crate::file_tree::stop_watching(&root_path, &state)
}
