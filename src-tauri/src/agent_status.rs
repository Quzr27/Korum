use crate::pty::{PtyAgentProbe, PtyState};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

pub const AGENT_STATUS_CHANGED_EVENT: &str = "korum://agent-status-changed";

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const CLAUDE_POLL_INTERVAL_MS: u64 = 2_000;
const CLAUDE_ERROR_BACKOFF_MS: u64 = 10_000;
const RECENT_SCROLLBACK_LINES: usize = 24;
const RECENT_CODEX_FS_MS: u64 = 2_500;
const CODEX_SESSION_SCAN_MAX_FILES: usize = 2_048;
const CODEX_SESSION_SCAN_MAX_DEPTH: usize = 8;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentKind {
    Claude,
    Codex,
    Aider,
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentActivity {
    Working,
    Waiting,
    Idle,
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentStatusSource {
    ClaudeJson,
    CodexFs,
    Scrollback,
    None,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub terminal_id: String,
    pub kind: AgentKind,
    pub activity: AgentActivity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub source: AgentStatusSource,
    pub updated_at: u64,
}

#[derive(Clone, Debug)]
struct AgentTerminalRegistration {
    terminal_id: String,
    pty_id: String,
    cwd: Option<String>,
    workspace_root: Option<String>,
}

struct AgentStatusInner {
    registrations: Mutex<HashMap<String, AgentTerminalRegistration>>,
    statuses: Mutex<HashMap<String, AgentStatus>>,
    poller_running: AtomicBool,
}

#[derive(Clone)]
pub struct AgentStatusState {
    inner: Arc<AgentStatusInner>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ClaudeAgentRecord {
    cwd: Option<String>,
    activity: AgentActivity,
    detail: Option<String>,
}

#[derive(Default)]
struct ClaudeAgentsCache {
    records: Vec<ClaudeAgentRecord>,
    next_fetch_at_ms: u64,
}

struct StatusProbe {
    registration: AgentTerminalRegistration,
    probe: Option<PtyAgentProbe>,
    kind: AgentKind,
    process_cwd: Option<String>,
}

impl AgentStatusState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(AgentStatusInner {
                registrations: Mutex::new(HashMap::new()),
                statuses: Mutex::new(HashMap::new()),
                poller_running: AtomicBool::new(false),
            }),
        }
    }

    pub fn register(
        &self,
        terminal_id: String,
        pty_id: String,
        cwd: Option<String>,
        workspace_root: Option<String>,
    ) -> Result<(), String> {
        let registration = AgentTerminalRegistration {
            terminal_id: terminal_id.clone(),
            pty_id,
            cwd,
            workspace_root,
        };
        self.inner
            .registrations
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?
            .insert(terminal_id, registration);
        Ok(())
    }

    pub fn unregister(&self, terminal_id: &str) -> Result<(), String> {
        self.inner
            .registrations
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?
            .remove(terminal_id);
        self.inner
            .statuses
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?
            .remove(terminal_id);
        Ok(())
    }

    pub fn get_statuses(&self) -> Result<Vec<AgentStatus>, String> {
        let mut statuses = self
            .inner
            .statuses
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        statuses.sort_by(|a, b| a.terminal_id.cmp(&b.terminal_id));
        Ok(statuses)
    }

    pub fn ensure_poller(&self, app: AppHandle, pty_state: PtyState) {
        if self
            .inner
            .poller_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }

        let state = self.clone();
        thread::spawn(move || {
            let mut claude_cache = ClaudeAgentsCache::default();
            loop {
                let registrations = state.registrations();
                if !registrations.is_empty() {
                    let now = now_ms();
                    let statuses =
                        build_agent_statuses(&registrations, &pty_state, &mut claude_cache, now);
                    let changed = state.replace_changed_statuses(statuses);
                    if !changed.is_empty() {
                        let _ = app.emit(AGENT_STATUS_CHANGED_EVENT, &changed);
                    }
                }
                thread::sleep(POLL_INTERVAL);
            }
        });
    }

    fn registrations(&self) -> Vec<AgentTerminalRegistration> {
        self.inner
            .registrations
            .lock()
            .map(|registrations| registrations.values().cloned().collect())
            .unwrap_or_default()
    }

    fn replace_changed_statuses(&self, statuses: Vec<AgentStatus>) -> Vec<AgentStatus> {
        let Ok(mut current) = self.inner.statuses.lock() else {
            return Vec::new();
        };

        let status_ids = statuses
            .iter()
            .map(|status| status.terminal_id.clone())
            .collect::<HashSet<_>>();
        current.retain(|terminal_id, _| status_ids.contains(terminal_id));

        let mut changed = Vec::new();
        for status in statuses {
            let should_emit = current
                .get(&status.terminal_id)
                .is_none_or(|previous| !same_status_value(previous, &status));
            if should_emit {
                current.insert(status.terminal_id.clone(), status.clone());
                changed.push(status);
            }
        }
        changed
    }
}

fn same_status_value(a: &AgentStatus, b: &AgentStatus) -> bool {
    a.kind == b.kind && a.activity == b.activity && a.detail == b.detail && a.source == b.source
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn build_agent_statuses(
    registrations: &[AgentTerminalRegistration],
    pty_state: &PtyState,
    claude_cache: &mut ClaudeAgentsCache,
    now: u64,
) -> Vec<AgentStatus> {
    let probes = registrations
        .iter()
        .map(|registration| {
            let probe = pty_state.agent_probe(&registration.pty_id).ok();
            let kind = detect_agent_kind(probe.as_ref());
            let process_cwd = probe
                .as_ref()
                .and_then(|probe| probe.foreground_process_group)
                .and_then(process_cwd_for_pid);
            StatusProbe {
                registration: registration.clone(),
                probe,
                kind,
                process_cwd,
            }
        })
        .collect::<Vec<_>>();

    let claude_cwds = probes
        .iter()
        .filter(|probe| probe.kind == AgentKind::Claude)
        .filter_map(effective_cwd)
        .collect::<Vec<_>>();
    let claude_records = if claude_cwds.is_empty() {
        Vec::new()
    } else {
        claude_cache.records(now)
    };
    let codex_count = probes
        .iter()
        .filter(|probe| probe.kind == AgentKind::Codex)
        .count();
    let codex_fs_activity = (codex_count == 1).then(|| codex_fs_activity(now)).flatten();

    probes
        .iter()
        .map(|probe| {
            status_from_probe(
                probe,
                &claude_cwds,
                &claude_records,
                codex_count,
                codex_fs_activity.clone(),
                now,
            )
        })
        .collect()
}

fn status_from_probe(
    probe: &StatusProbe,
    claude_cwds: &[String],
    claude_records: &[ClaudeAgentRecord],
    codex_count: usize,
    codex_fs_activity: Option<AgentActivity>,
    now: u64,
) -> AgentStatus {
    if probe.kind == AgentKind::Claude {
        if let Some(cwd) = effective_cwd(probe) {
            let normalized = normalize_path_text(&cwd);
            let terminal_matches = normalized
                .as_ref()
                .map(|cwd| {
                    claude_cwds
                        .iter()
                        .filter(|candidate| normalize_path_text(candidate).as_ref() == Some(cwd))
                        .count()
                })
                .unwrap_or(0);

            if terminal_matches > 1 {
                return AgentStatus {
                    terminal_id: probe.registration.terminal_id.clone(),
                    kind: AgentKind::Claude,
                    activity: AgentActivity::Unknown,
                    detail: Some("Ambiguous workspace path".to_string()),
                    source: AgentStatusSource::None,
                    updated_at: now,
                };
            }

            if claude_record_match_count(&cwd, claude_records) > 1 {
                return AgentStatus {
                    terminal_id: probe.registration.terminal_id.clone(),
                    kind: AgentKind::Claude,
                    activity: AgentActivity::Unknown,
                    detail: Some("Ambiguous Claude session".to_string()),
                    source: AgentStatusSource::None,
                    updated_at: now,
                };
            }

            if let Some(record) = correlate_claude_record(&cwd, claude_cwds, claude_records) {
                return AgentStatus {
                    terminal_id: probe.registration.terminal_id.clone(),
                    kind: AgentKind::Claude,
                    activity: record.activity,
                    detail: None,
                    source: AgentStatusSource::ClaudeJson,
                    updated_at: now,
                };
            }
        }
    }

    let fallback = fallback_scrollback_status(
        &probe.registration.terminal_id,
        probe.kind.clone(),
        probe.probe.as_ref(),
        now,
    );
    if probe.kind == AgentKind::Codex
        && fallback.activity == AgentActivity::Unknown
        && codex_count == 1
    {
        if let Some(activity) = codex_fs_activity {
            return AgentStatus {
                terminal_id: probe.registration.terminal_id.clone(),
                kind: AgentKind::Codex,
                activity,
                detail: None,
                source: AgentStatusSource::CodexFs,
                updated_at: now,
            };
        }
    }
    fallback
}

fn fallback_scrollback_status(
    terminal_id: &str,
    kind: AgentKind,
    probe: Option<&PtyAgentProbe>,
    now: u64,
) -> AgentStatus {
    let activity = probe
        .map(|probe| classify_scrollback(&probe.scrollback, probe.last_output_at, now))
        .unwrap_or(AgentActivity::Unknown);
    let source = if activity == AgentActivity::Unknown {
        AgentStatusSource::None
    } else {
        AgentStatusSource::Scrollback
    };

    AgentStatus {
        terminal_id: terminal_id.to_string(),
        kind,
        activity,
        detail: None,
        source,
        updated_at: now,
    }
}

fn effective_cwd(probe: &StatusProbe) -> Option<String> {
    probe
        .process_cwd
        .clone()
        .or_else(|| {
            probe
                .probe
                .as_ref()
                .and_then(|pty_probe| pty_probe.cwd.clone())
        })
        .or_else(|| probe.registration.cwd.clone())
        .or_else(|| probe.registration.workspace_root.clone())
}

impl ClaudeAgentsCache {
    fn records(&mut self, now: u64) -> Vec<ClaudeAgentRecord> {
        if now < self.next_fetch_at_ms {
            return self.records.clone();
        }

        match fetch_claude_agents() {
            Ok(records) => {
                self.records = records;
                self.next_fetch_at_ms = now.saturating_add(CLAUDE_POLL_INTERVAL_MS);
            }
            Err(_) => {
                self.records = Vec::new();
                self.next_fetch_at_ms = now.saturating_add(CLAUDE_ERROR_BACKOFF_MS);
            }
        }
        self.records.clone()
    }
}

fn fetch_claude_agents() -> Result<Vec<ClaudeAgentRecord>, String> {
    let output = Command::new("claude")
        .args(["agents", "--json"])
        .output()
        .map_err(|error| format!("claude agents unavailable: {error}"))?;

    if !output.status.success() {
        return Err(format!("claude agents exited with {}", output.status));
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    parse_claude_agents_json(&raw)
}

fn parse_claude_agents_json(raw: &str) -> Result<Vec<ClaudeAgentRecord>, String> {
    let value = serde_json::from_str::<Value>(raw).map_err(|error| error.to_string())?;
    let mut records = Vec::new();
    collect_claude_records(&value, &mut records);
    Ok(records)
}

fn collect_claude_records(value: &Value, records: &mut Vec<ClaudeAgentRecord>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_claude_records(item, records);
            }
        }
        Value::Object(object) => {
            if let Some(record) = claude_record_from_object(object) {
                records.push(record);
            } else {
                for item in object.values() {
                    collect_claude_records(item, records);
                }
            }
        }
        _ => {}
    }
}

fn claude_record_from_object(object: &Map<String, Value>) -> Option<ClaudeAgentRecord> {
    let cwd = extract_string_field(
        object,
        &[
            "cwd",
            "workingDirectory",
            "working_directory",
            "projectPath",
            "project_path",
            "workspace",
            "rootPath",
            "root_path",
            "path",
        ],
    )?;
    let status_text = extract_string_field(object, &["activity", "status", "state"]);
    let done = extract_u64_field(object, &["done", "completed", "complete"]);
    let total = extract_u64_field(object, &["total", "count"]);
    let activity = status_text
        .as_deref()
        .and_then(activity_from_status_text)
        .or_else(|| activity_from_counts(done, total))
        .unwrap_or(AgentActivity::Unknown);

    Some(ClaudeAgentRecord {
        cwd: Some(cwd),
        activity,
        detail: None,
    })
}

fn extract_string_field(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        object.get(*key).and_then(|value| {
            value.as_str().and_then(|text| {
                let trimmed = text.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            })
        })
    })
}

fn extract_u64_field(object: &Map<String, Value>, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        object.get(*key).and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
        })
    })
}

fn activity_from_status_text(status: &str) -> Option<AgentActivity> {
    let status = status.to_ascii_lowercase();
    if contains_any(
        &status,
        &["waiting", "blocked", "input", "approval", "permission"],
    ) {
        return Some(AgentActivity::Waiting);
    }
    if contains_any(&status, &["running", "working", "active", "busy"]) {
        return Some(AgentActivity::Working);
    }
    if contains_any(
        &status,
        &["idle", "done", "complete", "completed", "finished"],
    ) {
        return Some(AgentActivity::Idle);
    }
    None
}

fn activity_from_counts(done: Option<u64>, total: Option<u64>) -> Option<AgentActivity> {
    match (done, total) {
        (Some(done), Some(total)) if total > 0 && done < total => Some(AgentActivity::Working),
        (Some(done), Some(total)) if total > 0 && done >= total => Some(AgentActivity::Idle),
        _ => None,
    }
}

fn correlate_claude_record(
    cwd: &str,
    terminal_cwds: &[String],
    records: &[ClaudeAgentRecord],
) -> Option<ClaudeAgentRecord> {
    let normalized_cwd = normalize_path_text(cwd)?;
    let terminal_matches = terminal_cwds
        .iter()
        .filter(|candidate| normalize_path_text(candidate).as_ref() == Some(&normalized_cwd))
        .count();
    if terminal_matches != 1 {
        return None;
    }

    let mut matches = records
        .iter()
        .filter(|record| {
            record.cwd.as_deref().and_then(normalize_path_text).as_ref() == Some(&normalized_cwd)
        })
        .cloned()
        .collect::<Vec<_>>();

    if matches.len() == 1 {
        matches.pop()
    } else {
        None
    }
}

fn claude_record_match_count(cwd: &str, records: &[ClaudeAgentRecord]) -> usize {
    let Some(normalized_cwd) = normalize_path_text(cwd) else {
        return 0;
    };
    records
        .iter()
        .filter(|record| {
            record.cwd.as_deref().and_then(normalize_path_text).as_ref() == Some(&normalized_cwd)
        })
        .count()
}

fn normalize_path_text(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = Path::new(trimmed);
    if let Ok(canonical) = path.canonicalize() {
        return Some(canonical.to_string_lossy().to_string());
    }
    if trimmed == "/" {
        Some(trimmed.to_string())
    } else {
        Some(trimmed.trim_end_matches('/').to_string())
    }
}

fn detect_agent_kind(probe: Option<&PtyAgentProbe>) -> AgentKind {
    let Some(probe) = probe else {
        return AgentKind::Unknown;
    };

    if let Some(pid) = probe.foreground_process_group {
        if let Some(command) = process_command_for_pid(pid) {
            let kind = kind_from_process_command(&command);
            if kind != AgentKind::Unknown {
                return kind;
            }
        }
    }

    kind_from_scrollback(&probe.scrollback)
}

#[cfg(target_os = "macos")]
fn process_command_for_pid(pid: i32) -> Option<String> {
    let pid = pid.to_string();
    let output = Command::new("/bin/ps")
        .args(["-p", &pid, "-o", "command="])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|command| !command.is_empty())
}

#[cfg(not(target_os = "macos"))]
fn process_command_for_pid(_pid: i32) -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
fn process_cwd_for_pid(pid: i32) -> Option<String> {
    let pid = pid.to_string();
    let output = Command::new("/usr/sbin/lsof")
        .args(["-a", "-p", &pid, "-d", "cwd", "-Fn"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.strip_prefix('n'))
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(ToString::to_string)
}

#[cfg(not(target_os = "macos"))]
fn process_cwd_for_pid(_pid: i32) -> Option<String> {
    None
}

fn kind_from_process_command(command: &str) -> AgentKind {
    for token in command.split_whitespace() {
        let cleaned = token.trim_matches(|ch| ch == '"' || ch == '\'' || ch == ',' || ch == ';');
        let file_name = Path::new(cleaned)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(cleaned)
            .to_ascii_lowercase();

        let kind = kind_from_binary_name(&file_name);
        if kind != AgentKind::Unknown {
            return kind;
        }
    }
    AgentKind::Unknown
}

fn kind_from_binary_name(name: &str) -> AgentKind {
    let name = name.trim_end_matches(".js").trim_end_matches(".mjs");
    if name == "claude" || name == "claude-code" || name.starts_with("claude-") {
        AgentKind::Claude
    } else if name == "codex" || name.starts_with("codex-") {
        AgentKind::Codex
    } else if name == "aider" || name.starts_with("aider-") {
        AgentKind::Aider
    } else {
        AgentKind::Unknown
    }
}

fn kind_from_scrollback(scrollback: &str) -> AgentKind {
    let text = strip_ansi(scrollback).to_ascii_lowercase();
    if contains_any(&text, &["claude code", "welcome to claude", "claude>"]) {
        AgentKind::Claude
    } else if text.contains("openai codex")
        || (text.contains("codex") && text.contains("esc to interrupt"))
    {
        AgentKind::Codex
    } else if contains_any(&text, &["aider chat", "aider v", "aider is"]) {
        AgentKind::Aider
    } else {
        AgentKind::Unknown
    }
}

fn classify_scrollback(scrollback: &str, last_output_at: Option<u64>, now: u64) -> AgentActivity {
    let clean = strip_ansi(scrollback).to_ascii_lowercase();
    let recent = recent_scrollback_lines(&clean, RECENT_SCROLLBACK_LINES);
    if recent.trim().is_empty() {
        return AgentActivity::Unknown;
    }

    if let Some(last_output_at) = last_output_at {
        let age = now.saturating_sub(last_output_at);
        if age >= 8_000 && has_idle_prompt(&recent) {
            return AgentActivity::Idle;
        }
    }

    if contains_any(
        &recent,
        &[
            "allow command",
            "approve",
            "approval",
            "permission",
            "waiting for input",
            "do you want",
            "press enter",
            "continue?",
            "proceed?",
            "[y/n]",
            "yes/no",
        ],
    ) {
        return AgentActivity::Waiting;
    }

    if contains_any(
        &recent,
        &[
            "esc to interrupt",
            "ctrl-c to interrupt",
            "thinking",
            "working",
            "running",
        ],
    ) {
        if last_output_at
            .map(|last_output_at| now.saturating_sub(last_output_at) <= 10_000)
            .unwrap_or(true)
        {
            return AgentActivity::Working;
        }
    }

    AgentActivity::Unknown
}

fn recent_scrollback_lines(scrollback: &str, max_lines: usize) -> String {
    let mut lines = VecDeque::with_capacity(max_lines);
    for line in scrollback.lines() {
        if lines.len() == max_lines {
            lines.pop_front();
        }
        lines.push_back(line);
    }
    lines.into_iter().collect::<Vec<_>>().join("\n")
}

fn has_idle_prompt(text: &str) -> bool {
    text.lines()
        .rev()
        .find_map(|line| {
            let trimmed = line.trim_end();
            (!trimmed.is_empty()).then_some(trimmed)
        })
        .is_some_and(|line| {
            line.ends_with('$')
                || line.ends_with('%')
                || line.ends_with('#')
                || line.ends_with('>')
                || line.ends_with('›')
        })
}

fn strip_ansi(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            output.push(ch);
            continue;
        }

        while let Some(next) = chars.next() {
            if next.is_ascii_alphabetic() {
                break;
            }
        }
    }
    output
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn codex_fs_activity(now: u64) -> Option<AgentActivity> {
    codex_sessions_root().and_then(|root| codex_fs_activity_from_root(&root, now))
}

fn codex_sessions_root() -> Option<PathBuf> {
    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        return Some(PathBuf::from(codex_home).join("sessions"));
    }
    std::env::var("HOME")
        .ok()
        .map(|home| PathBuf::from(home).join(".codex").join("sessions"))
}

fn codex_fs_activity_from_root(root: &Path, now: u64) -> Option<AgentActivity> {
    let latest = latest_modified_ms(root)?;
    (now.saturating_sub(latest) <= RECENT_CODEX_FS_MS).then_some(AgentActivity::Working)
}

fn latest_modified_ms(root: &Path) -> Option<u64> {
    let mut remaining = CODEX_SESSION_SCAN_MAX_FILES;
    let mut latest = None;
    scan_latest_modified(root, 0, &mut remaining, &mut latest);
    latest
}

fn scan_latest_modified(
    path: &Path,
    depth: usize,
    remaining: &mut usize,
    latest: &mut Option<u64>,
) {
    if *remaining == 0 || depth > CODEX_SESSION_SCAN_MAX_DEPTH {
        return;
    }

    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.is_file() {
        *remaining = remaining.saturating_sub(1);
        if let Ok(modified) = metadata.modified() {
            let modified_ms = modified
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0);
            if latest.is_none_or(|current| modified_ms > current) {
                *latest = Some(modified_ms);
            }
        }
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        scan_latest_modified(&entry.path(), depth + 1, remaining, latest);
        if *remaining == 0 {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_from_process_command_maps_known_agent_binaries() {
        assert_eq!(
            kind_from_process_command("/opt/homebrew/bin/claude"),
            AgentKind::Claude
        );
        assert_eq!(
            kind_from_process_command("/usr/local/bin/node /opt/bin/codex"),
            AgentKind::Codex
        );
        assert_eq!(
            kind_from_process_command("/Users/me/.local/bin/aider --model sonnet"),
            AgentKind::Aider
        );
        assert_eq!(kind_from_process_command("/bin/zsh -l"), AgentKind::Unknown);
    }

    #[test]
    fn classify_scrollback_detects_codex_working_waiting_and_idle() {
        let now = 40_000;

        assert_eq!(
            classify_scrollback("thinking...\nesc to interrupt", Some(now - 500), now),
            AgentActivity::Working,
        );
        assert_eq!(
            classify_scrollback(
                "Allow command to run?\nApprove with y/n",
                Some(now - 500),
                now
            ),
            AgentActivity::Waiting,
        );
        assert_eq!(
            classify_scrollback("all done\n~/project $ ", Some(now - 30_000), now),
            AgentActivity::Idle,
        );
    }

    #[test]
    fn classify_scrollback_ignores_stale_prompts_when_recent_tail_is_idle() {
        let now = 80_000;
        let filler = (0..40)
            .map(|index| format!("completed line {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        let scrollback = format!("Allow command to run?\nApprove with y/n\n{filler}\n~/project $ ");

        assert_eq!(
            classify_scrollback(&scrollback, Some(now - 30_000), now),
            AgentActivity::Idle,
        );
    }

    #[test]
    fn classify_scrollback_keeps_recent_generic_output_unknown() {
        let now = 12_000;

        assert_eq!(
            classify_scrollback("cargo check\nCompiling crate", Some(now - 500), now),
            AgentActivity::Unknown,
        );
    }

    #[test]
    fn parse_claude_agents_json_is_defensive_about_shape() {
        let records = parse_claude_agents_json(
            r#"{
              "agents": [
                { "cwd": "/tmp/project", "status": "waiting", "summary": "Needs approval" },
                { "workingDirectory": "/tmp/other", "done": 2, "total": 5 },
                { "projectPath": "/tmp/finished", "status": "complete" },
                { "unexpected": true }
              ]
            }"#,
        )
        .expect("json should parse");

        assert_eq!(records.len(), 3);
        assert_eq!(records[0].cwd.as_deref(), Some("/tmp/project"));
        assert_eq!(records[0].activity, AgentActivity::Waiting);
        assert_eq!(records[0].detail, None);
        assert_eq!(records[1].activity, AgentActivity::Working);
        assert_eq!(records[2].activity, AgentActivity::Idle);
    }

    #[test]
    fn claude_cwd_correlation_refuses_ambiguous_terminals() {
        let status = correlate_claude_record(
            "/tmp/project",
            &[String::from("/tmp/project"), String::from("/tmp/project")],
            &[ClaudeAgentRecord {
                cwd: Some(String::from("/tmp/project")),
                activity: AgentActivity::Working,
                detail: Some(String::from("editing")),
            }],
        );

        assert!(status.is_none());
    }

    #[test]
    fn claude_duplicate_records_become_unknown_without_scrollback_fallback() {
        let probe = StatusProbe {
            registration: AgentTerminalRegistration {
                terminal_id: String::from("term-1"),
                pty_id: String::from("pty-1"),
                cwd: Some(String::from("/tmp/project")),
                workspace_root: None,
            },
            probe: None,
            kind: AgentKind::Claude,
            process_cwd: None,
        };
        let records = vec![
            ClaudeAgentRecord {
                cwd: Some(String::from("/tmp/project")),
                activity: AgentActivity::Working,
                detail: None,
            },
            ClaudeAgentRecord {
                cwd: Some(String::from("/tmp/project")),
                activity: AgentActivity::Waiting,
                detail: None,
            },
        ];

        let status = status_from_probe(
            &probe,
            &[String::from("/tmp/project")],
            &records,
            0,
            None,
            10,
        );

        assert_eq!(status.activity, AgentActivity::Unknown);
        assert_eq!(status.source, AgentStatusSource::None);
    }

    #[test]
    fn codex_fs_activity_uses_recent_session_metadata_without_reading_content() {
        let root = std::env::temp_dir().join(format!("korum-codex-fs-{}", uuid::Uuid::new_v4()));
        let nested = root.join("2026").join("06").join("06");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            nested.join("session.jsonl"),
            b"raw session text stays unread",
        )
        .unwrap();

        let activity = codex_fs_activity_from_root(&root, now_ms());

        fs::remove_dir_all(&root).unwrap();
        assert_eq!(activity, Some(AgentActivity::Working));
    }
}
