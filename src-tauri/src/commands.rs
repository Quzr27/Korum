use crate::agent_status::{AgentStatus, AgentStatusState};
use crate::file_tree::FileWatcherState;
use crate::pty::PtyState;
use crate::quit_guard::QuitGuardState;
use serde::Serialize;
use std::process::Command;
use tauri::ipc::{Channel, Response};
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
    // Raw byte body (ArrayBuffer on the JS side) — see TerminalStream.channel.
    output_channel: Channel<Response>,
) -> Result<(), String> {
    state.attach(&id, output_channel)
}

#[tauri::command]
pub fn detach_terminal(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    state.detach(&id)
}

/// Flow control: frontend pauses the PTY read thread when its xterm parse
/// buffer is backed up, and resumes once drained (see useXtermSession).
#[tauri::command]
pub fn pause_terminal_read(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    state.pause_read(&id)
}

#[tauri::command]
pub fn resume_terminal_read(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    state.resume_read(&id)
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

#[tauri::command]
pub fn get_terminal_preview(
    state: State<'_, PtyState>,
    id: String,
    max_lines: Option<usize>,
) -> Result<String, String> {
    state.preview(&id, max_lines.unwrap_or(40).min(200))
}

#[tauri::command]
pub fn register_agent_terminal(
    app: tauri::AppHandle,
    state: State<'_, AgentStatusState>,
    pty_state: State<'_, PtyState>,
    terminal_id: String,
    pty_id: String,
    cwd: Option<String>,
    workspace_root: Option<String>,
) -> Result<(), String> {
    state.register(terminal_id, pty_id, cwd, workspace_root)?;
    state.ensure_poller(app, pty_state.inner().clone());
    Ok(())
}

#[tauri::command]
pub fn unregister_agent_terminal(
    state: State<'_, AgentStatusState>,
    terminal_id: String,
) -> Result<(), String> {
    state.unregister(&terminal_id)
}

#[tauri::command]
pub fn get_agent_statuses(state: State<'_, AgentStatusState>) -> Result<Vec<AgentStatus>, String> {
    state.get_statuses()
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed != url
        || trimmed
            .chars()
            .any(|ch| ch.is_ascii_control() || ch.is_whitespace())
    {
        return Err("Invalid URL".to_string());
    }

    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("Only http(s) URLs can be opened".to_string());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(trimmed);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler").arg(trimmed);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(trimmed);
        command
    };

    command
        .spawn()
        .map_err(|err| format!("Failed to open URL: {err}"))?;
    Ok(())
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
pub async fn save_state(app: tauri::AppHandle, state: serde_json::Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::storage::save_state(&app, &state))
        .await
        .map_err(|e| format!("save_state task failed: {e}"))?
}

#[tauri::command]
pub fn load_state(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    crate::storage::load_state(&app)
}

#[tauri::command]
pub async fn save_settings(
    app: tauri::AppHandle,
    settings: serde_json::Value,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::storage::save_settings(&app, &settings))
        .await
        .map_err(|e| format!("save_settings task failed: {e}"))?
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
pub async fn read_directory(
    path: String,
    show_ignored: Option<bool>,
) -> Result<Vec<crate::file_tree::FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::file_tree::read_directory(&path, show_ignored.unwrap_or(false))
    })
    .await
    .map_err(|e| format!("read_directory task failed: {e}"))?
}

#[tauri::command]
pub fn get_git_status(root_path: String) -> Result<crate::file_tree::GitStatusResult, String> {
    crate::file_tree::get_git_status(&root_path)
}

#[tauri::command]
pub fn get_git_file_status(
    path: String,
    root: String,
) -> Result<Option<crate::file_tree::GitFileStatus>, String> {
    crate::file_tree::get_git_file_status(&path, &root)
}

#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, String> {
    crate::file_tree::read_file_content(&path)
}

#[tauri::command]
pub fn read_code_file_content(path: String) -> Result<String, String> {
    crate::file_tree::read_code_file_content(&path)
}

#[tauri::command]
pub fn get_file_diff(
    path: String,
    root: String,
) -> Result<Vec<crate::file_tree::DiffLine>, String> {
    crate::file_tree::get_file_diff(&path, &root)
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
pub fn stop_watching(state: State<'_, FileWatcherState>, root_path: String) -> Result<(), String> {
    crate::file_tree::stop_watching(&root_path, &state)
}
