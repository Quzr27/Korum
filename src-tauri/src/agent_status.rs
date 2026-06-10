use crate::pty::{PtyAgentProbe, PtyState};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

pub const AGENT_STATUS_CHANGED_EVENT: &str = "korum://agent-status-changed";

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const CLAUDE_POLL_INTERVAL_MS: u64 = 2_000;
const CLAUDE_ERROR_BACKOFF_MS: u64 = 10_000;
const RECENT_SCROLLBACK_LINES: usize = 80;
const WAITING_TAIL_LINES: usize = 12;
const RECENT_CODEX_FS_MS: u64 = 2_500;
const CODEX_SESSION_SCAN_MAX_FILES: usize = 2_048;
const CODEX_SESSION_SCAN_MAX_DEPTH: usize = 8;

// Scrollback hysteresis: once an agent is positively detected as working, keep
// reporting `working` through quiet think-gaps and large tool-output dumps so the
// status holds for the whole task instead of flickering between tool calls.
const WORKING_FRESH_MS: u64 = 6_000; // output this recent counts as actively streaming
const WORKING_STICKY_MS: u64 = 15_000; // keep working while output still streams but marker scrolled away
const WORKING_GRACE_MS: u64 = 5_000; // keep working across a brief quiet think-gap
const IDLE_QUIET_MS: u64 = 8_000; // quiet at least this long before a prompt reads as idle

// Interrupt hints shown by Claude/Codex TUIs while a turn is in progress. Kept
// high-precision (no generic "working"/"running") so ordinary shell output never
// gets stuck green via the hysteresis window.
const WORKING_MARKERS: &[&str] = &[
    "esc to interrupt",
    "ctrl-c to interrupt",
    "ctrl+c to interrupt",
    "esc to cancel",
];

// Explicit approval/input prompts. Only checked against the very bottom of the
// scrollback because these prompts always render at the end of the buffer.
// Kept phrase-specific: bare "approve"/"permission" matched ordinary output like
// "Permission denied (publickey)" or "PR approved" and falsely flipped to waiting.
const WAITING_MARKERS: &[&str] = &[
    "allow command",
    "waiting for input",
    "do you want",
    "press enter",
    "continue?",
    "proceed?",
    "[y/n]",
    "(y/n)",
    "yes/no",
    "approve this",
    "do you approve",
];

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
    /// Set to `true` during app teardown. The poller thread checks this flag
    /// every cycle and exits its loop when it is set.
    shutdown: AtomicBool,
}

#[derive(Clone)]
pub struct AgentStatusState {
    inner: Arc<AgentStatusInner>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ClaudeAgentRecord {
    pid: Option<i64>,
    cwd: Option<String>,
    activity: AgentActivity,
    detail: Option<String>,
}

/// Result of a scrollback classification pass, carrying the working-since stamp
/// the poller should remember for this terminal so `working` can stay sticky.
struct ScrollbackVerdict {
    activity: AgentActivity,
    last_working_at: Option<u64>,
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

/// Per-pid cache entry for `process_command_for_pid`. A running process's
/// command line never changes, so we cache it for the pid's lifetime and only
/// invalidate when the pid disappears (probe returns a different pid).
#[derive(Default)]
struct ProcessCommandCache {
    /// Maps pid → cached command string.
    commands: HashMap<i32, String>,
}

impl ProcessCommandCache {
    /// Return the cached command for `pid`, calling `process_command_for_pid`
    /// on a cache miss and storing the result. Stale entries (pids no longer
    /// present in the current poll) should be evicted via `retain_pids`.
    fn get(&mut self, pid: i32) -> Option<&str> {
        if let std::collections::hash_map::Entry::Vacant(e) = self.commands.entry(pid) {
            if let Some(cmd) = process_command_for_pid(pid) {
                e.insert(cmd);
            }
        }
        self.commands.get(&pid).map(|s| s.as_str())
    }

    /// Remove cache entries whose pids are not in `active_pids`.
    fn retain_pids(&mut self, active_pids: &HashSet<i32>) {
        self.commands.retain(|pid, _| active_pids.contains(pid));
    }
}

impl AgentStatusState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(AgentStatusInner {
                registrations: Mutex::new(HashMap::new()),
                statuses: Mutex::new(HashMap::new()),
                poller_running: AtomicBool::new(false),
                shutdown: AtomicBool::new(false),
            }),
        }
    }

    /// Signal the poller thread to exit. Call this during app shutdown
    /// (from the `ExitRequested` handler in lib.rs) before the process exits.
    pub fn shutdown(&self) {
        self.inner.shutdown.store(true, Ordering::SeqCst);
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
            let mut working_memory: HashMap<String, u64> = HashMap::new();
            let mut cmd_cache = ProcessCommandCache::default();
            // Track consecutive app.emit() failures so we stop trying after
            // the app window has been torn down.
            let mut consecutive_emit_failures: u32 = 0;
            loop {
                // Exit cleanly when the app is shutting down.
                if state.inner.shutdown.load(Ordering::SeqCst) {
                    break;
                }
                let registrations = state.registrations();
                if !registrations.is_empty() {
                    let now = now_ms();
                    let statuses = build_agent_statuses(
                        &registrations,
                        &pty_state,
                        &mut claude_cache,
                        &mut working_memory,
                        &mut cmd_cache,
                        now,
                    );
                    let changed = state.replace_changed_statuses(statuses);
                    if !changed.is_empty() {
                        if app.emit(AGENT_STATUS_CHANGED_EVENT, &changed).is_err() {
                            consecutive_emit_failures += 1;
                            // 5 consecutive failures almost certainly means the
                            // webview has gone away — stop emitting to avoid
                            // busy-looping against a dead target.
                            if consecutive_emit_failures >= 5 {
                                break;
                            }
                        } else {
                            consecutive_emit_failures = 0;
                        }
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
    working_memory: &mut HashMap<String, u64>,
    cmd_cache: &mut ProcessCommandCache,
    now: u64,
) -> Vec<AgentStatus> {
    // Collect current foreground pids so we can evict stale cache entries.
    let mut active_pids: HashSet<i32> = HashSet::new();

    let probes = registrations
        .iter()
        .map(|registration| {
            let probe = pty_state.agent_probe(&registration.pty_id).ok();
            // Track active pids for cache eviction below.
            if let Some(pid) = probe.as_ref().and_then(|p| p.foreground_process_group) {
                active_pids.insert(pid);
            }
            // Use cached command lookup so we don't fork /bin/ps every 2 s per terminal.
            let kind = detect_agent_kind_cached(probe.as_ref(), cmd_cache);
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

    // Evict cached commands for pids that are no longer the foreground process.
    cmd_cache.retain_pids(&active_pids);

    let has_claude = probes.iter().any(|probe| probe.kind == AgentKind::Claude);
    let claude_cwds = probes
        .iter()
        .filter(|probe| probe.kind == AgentKind::Claude)
        .filter_map(effective_cwd)
        .collect::<Vec<_>>();
    let claude_records = if has_claude {
        claude_cache.records(now)
    } else {
        Vec::new()
    };
    let codex_count = probes
        .iter()
        .filter(|probe| probe.kind == AgentKind::Codex)
        .count();
    let codex_fs_activity = (codex_count == 1).then(|| codex_fs_activity(now)).flatten();

    // Drop working-memory for terminals that are no longer registered.
    let active_ids = probes
        .iter()
        .map(|probe| probe.registration.terminal_id.as_str())
        .collect::<HashSet<_>>();
    working_memory.retain(|terminal_id, _| active_ids.contains(terminal_id.as_str()));

    let mut statuses = Vec::with_capacity(probes.len());
    for probe in &probes {
        let terminal_id = probe.registration.terminal_id.clone();
        let prev_working_at = working_memory.get(&terminal_id).copied();
        let (status, next_working_at) = status_from_probe(
            probe,
            &claude_cwds,
            &claude_records,
            codex_count,
            codex_fs_activity.clone(),
            now,
            prev_working_at,
        );
        match next_working_at {
            Some(stamp) => {
                working_memory.insert(terminal_id, stamp);
            }
            None => {
                working_memory.remove(&terminal_id);
            }
        }
        statuses.push(status);
    }
    statuses
}

fn status_from_probe(
    probe: &StatusProbe,
    claude_cwds: &[String],
    claude_records: &[ClaudeAgentRecord],
    codex_count: usize,
    codex_fs_activity: Option<AgentActivity>,
    now: u64,
    prev_working_at: Option<u64>,
) -> (AgentStatus, Option<u64>) {
    if probe.kind == AgentKind::Claude {
        // Prefer correlating by foreground process group pid. The interactive
        // `claude` process is its own group leader, so its pid matches the pid
        // reported by `claude agents --json`. This disambiguates the common case
        // of several Claude sessions sharing one repo cwd, where cwd matching alone
        // cannot tell the sessions apart.
        let pgid = probe
            .probe
            .as_ref()
            .and_then(|pty_probe| pty_probe.foreground_process_group);
        if let Some(record) = pgid.and_then(|pgid| correlate_claude_record_by_pid(pgid, claude_records)) {
            let activity = escalate_claude_activity(record.activity.clone(), probe);
            return (claude_json_status(probe, &activity, now), working_stamp(&activity, now));
        }

        // Fall back to cwd correlation only when a single session owns the cwd.
        if let Some(cwd) = effective_cwd(probe) {
            if let Some(record) = correlate_claude_record(&cwd, claude_cwds, claude_records) {
                let activity = escalate_claude_activity(record.activity, probe);
                return (claude_json_status(probe, &activity, now), working_stamp(&activity, now));
            }
            // Ambiguous or unmatched cwd falls through to per-terminal scrollback,
            // which naturally reads each terminal's own working state.
        }
    }

    let (fallback, next_working_at) = fallback_scrollback_status(
        &probe.registration.terminal_id,
        probe.kind.clone(),
        probe.probe.as_ref(),
        now,
        prev_working_at,
    );
    if probe.kind == AgentKind::Codex
        && fallback.activity == AgentActivity::Unknown
        && codex_count == 1
    {
        if let Some(activity) = codex_fs_activity {
            return (
                AgentStatus {
                    terminal_id: probe.registration.terminal_id.clone(),
                    kind: AgentKind::Codex,
                    activity,
                    detail: None,
                    source: AgentStatusSource::CodexFs,
                    updated_at: now,
                },
                None,
            );
        }
    }
    (fallback, next_working_at)
}

fn claude_json_status(probe: &StatusProbe, activity: &AgentActivity, now: u64) -> AgentStatus {
    AgentStatus {
        terminal_id: probe.registration.terminal_id.clone(),
        kind: AgentKind::Claude,
        activity: activity.clone(),
        detail: None,
        source: AgentStatusSource::ClaudeJson,
        updated_at: now,
    }
}

/// Keep the scrollback hysteresis stamp warm while an authoritative source reports
/// `working`, so a transient `claude agents --json` gap (e.g. its 10s error
/// backoff) hands off to scrollback without cold-starting and flickering.
fn working_stamp(activity: &AgentActivity, now: u64) -> Option<u64> {
    (*activity == AgentActivity::Working).then_some(now)
}

/// `claude agents --json` reports `busy` even while the session is blocked on an
/// approval/input prompt. Escalate to `waiting` (the strongest attention state)
/// when the terminal's bottom rows show such a prompt.
fn escalate_claude_activity(activity: AgentActivity, probe: &StatusProbe) -> AgentActivity {
    if activity == AgentActivity::Working && probe_scrollback_waiting(probe) {
        AgentActivity::Waiting
    } else {
        activity
    }
}

fn probe_scrollback_waiting(probe: &StatusProbe) -> bool {
    probe
        .probe
        .as_ref()
        .map(|pty_probe| {
            let clean = strip_ansi(&pty_probe.scrollback).to_ascii_lowercase();
            let tail = recent_scrollback_lines(&clean, WAITING_TAIL_LINES);
            contains_any(&tail, WAITING_MARKERS)
        })
        .unwrap_or(false)
}

fn fallback_scrollback_status(
    terminal_id: &str,
    kind: AgentKind,
    probe: Option<&PtyAgentProbe>,
    now: u64,
    prev_working_at: Option<u64>,
) -> (AgentStatus, Option<u64>) {
    let verdict = probe
        .map(|probe| {
            classify_scrollback(&probe.scrollback, probe.last_output_at, now, prev_working_at)
        })
        .unwrap_or(ScrollbackVerdict {
            activity: AgentActivity::Unknown,
            last_working_at: None,
        });
    let source = if verdict.activity == AgentActivity::Unknown {
        AgentStatusSource::None
    } else {
        AgentStatusSource::Scrollback
    };

    (
        AgentStatus {
            terminal_id: terminal_id.to_string(),
            kind,
            activity: verdict.activity,
            detail: None,
            source,
            updated_at: now,
        },
        verdict.last_working_at,
    )
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
                // Successful fetch: update records (may be empty if no agents
                // are running — that's a real "nothing active" signal).
                self.records = records;
                self.next_fetch_at_ms = now.saturating_add(CLAUDE_POLL_INTERVAL_MS);
            }
            Err(_) => {
                // On error, RETAIN previous records to avoid status flicker.
                // Only advance the backoff timer; clear on next successful fetch.
                self.next_fetch_at_ms = now.saturating_add(CLAUDE_ERROR_BACKOFF_MS);
            }
        }
        self.records.clone()
    }
}

fn fetch_claude_agents() -> Result<Vec<ClaudeAgentRecord>, String> {
    let mut command = Command::new("claude");
    command.args(["agents", "--json"]);
    // A macOS app launched from Finder/Dock only inherits a minimal PATH, so a
    // bare `claude` lookup fails even though the user's terminal finds it. Give
    // the child the PATH a real login shell would build.
    if let Some(path) = claude_env_path() {
        command.env("PATH", path);
    }

    let output = command
        .output()
        .map_err(|error| format!("claude agents unavailable: {error}"))?;

    if !output.status.success() {
        return Err(format!("claude agents exited with {}", output.status));
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    parse_claude_agents_json(&raw)
}

/// PATH to use when spawning `claude`: the interactive login shell's PATH (which
/// carries version-manager shims like nvm/fnm/volta/asdf) first, then common
/// static install dirs, then whatever the app process already had. Built once and
/// cached — see [`user_shell_path`].
fn claude_env_path() -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(resolved) = user_shell_path() {
        parts.push(resolved.to_string());
    }
    if let Ok(home) = std::env::var("HOME") {
        for sub in [".local/bin", ".bun/bin", ".cargo/bin", ".deno/bin"] {
            parts.push(format!("{home}/{sub}"));
        }
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin"] {
        parts.push(dir.to_string());
    }
    if let Ok(existing) = std::env::var("PATH") {
        if !existing.is_empty() {
            parts.push(existing);
        }
    }
    (!parts.is_empty()).then(|| parts.join(":"))
}

/// PATH a normal interactive login shell would expose. Resolved once via
/// `$SHELL -ilc` (so rc/profile and version managers run) and cached for the
/// process. Returns `None` when the shell can't be run or yields nothing useful.
fn user_shell_path() -> Option<&'static str> {
    static USER_PATH: OnceLock<Option<String>> = OnceLock::new();
    USER_PATH
        .get_or_init(|| {
            let shell = std::env::var("SHELL")
                .ok()
                .filter(|shell| shell.starts_with('/'))
                .unwrap_or_else(|| "/bin/zsh".to_string());
            // Sentinel-wrap the value so noisy rc/profile output can't corrupt it.
            let output = Command::new(&shell)
                .args(["-ilc", "printf '__KORUM_PATH__%s__KORUM_END__' \"$PATH\""])
                .output()
                .ok()?;
            if !output.status.success() {
                return None;
            }
            let text = String::from_utf8_lossy(&output.stdout);
            let start = text.find("__KORUM_PATH__")? + "__KORUM_PATH__".len();
            let end = start + text[start..].find("__KORUM_END__")?;
            let path = text[start..end].trim();
            (path.contains('/')).then(|| path.to_string())
        })
        .as_deref()
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
    let pid = extract_i64_field(object, &["pid", "processId", "process_id"]);

    Some(ClaudeAgentRecord {
        pid,
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

fn extract_i64_field(object: &Map<String, Value>, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| {
        object.get(*key).and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
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

fn correlate_claude_record_by_pid(
    pgid: i32,
    records: &[ClaudeAgentRecord],
) -> Option<&ClaudeAgentRecord> {
    let target = pgid as i64;
    let mut matches = records.iter().filter(|record| record.pid == Some(target));
    let first = matches.next()?;
    // A pid is unique per session; bail if somehow two records claim it.
    if matches.next().is_some() {
        return None;
    }
    Some(first)
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

/// Uses `cmd_cache` so we only spawn `/bin/ps`
/// on the first observation of a given pid, not every poll tick.
fn detect_agent_kind_cached(
    probe: Option<&PtyAgentProbe>,
    cmd_cache: &mut ProcessCommandCache,
) -> AgentKind {
    let Some(probe) = probe else {
        return AgentKind::Unknown;
    };

    if let Some(pid) = probe.foreground_process_group {
        if let Some(command) = cmd_cache.get(pid) {
            let kind = kind_from_process_command(command);
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

fn classify_scrollback(
    scrollback: &str,
    last_output_at: Option<u64>,
    now: u64,
    prev_working_at: Option<u64>,
) -> ScrollbackVerdict {
    let clean = strip_ansi(scrollback).to_ascii_lowercase();
    let recent = recent_scrollback_lines(&clean, RECENT_SCROLLBACK_LINES);
    if recent.trim().is_empty() {
        return ScrollbackVerdict {
            activity: AgentActivity::Unknown,
            last_working_at: None,
        };
    }

    let age = last_output_at.map(|last_output_at| now.saturating_sub(last_output_at));
    let output_is_fresh = age.map(|age| age <= WORKING_FRESH_MS).unwrap_or(false);

    // Explicit approval/input prompts win — only consulted at the very bottom of
    // the buffer where such prompts render, so stale history never misfires.
    let waiting_tail = recent_scrollback_lines(&clean, WAITING_TAIL_LINES);
    if contains_any(&waiting_tail, WAITING_MARKERS) {
        return ScrollbackVerdict {
            activity: AgentActivity::Waiting,
            last_working_at: None,
        };
    }

    // Positive working signal: an interrupt hint while output is actively
    // streaming. Stamp the moment so the state can stay sticky afterwards.
    if output_is_fresh && contains_any(&recent, WORKING_MARKERS) {
        return ScrollbackVerdict {
            activity: AgentActivity::Working,
            last_working_at: Some(now),
        };
    }

    // Hysteresis: hold `working` across a large tool-output dump (marker scrolled
    // out of view but output still streaming) or a brief quiet think-gap. The
    // stamp is not advanced here, so it ages out unless the marker is seen again.
    if let Some(prev) = prev_working_at {
        let since = now.saturating_sub(prev);
        let within = if output_is_fresh {
            since <= WORKING_STICKY_MS
        } else {
            since <= WORKING_GRACE_MS
        };
        if within {
            return ScrollbackVerdict {
                activity: AgentActivity::Working,
                last_working_at: Some(prev),
            };
        }
    }

    // Quiet long enough while sitting on a shell/agent prompt → idle.
    if age.map(|age| age >= IDLE_QUIET_MS).unwrap_or(false) && has_idle_prompt(&recent) {
        return ScrollbackVerdict {
            activity: AgentActivity::Idle,
            last_working_at: None,
        };
    }

    ScrollbackVerdict {
        activity: AgentActivity::Unknown,
        last_working_at: None,
    }
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

pub(crate) fn strip_ansi(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            output.push(ch);
            continue;
        }

        // We have ESC — peek at the introducer byte.
        match chars.peek() {
            Some(&'[') => {
                // CSI: ESC [ — consume through the final byte (0x40–0x7E).
                chars.next(); // consume '['
                for next in chars.by_ref() {
                    if ('\x40'..='\x7e').contains(&next) {
                        break; // final byte consumed
                    }
                }
            }
            Some(&']') => {
                // OSC: ESC ] — consume until BEL (\x07) or ST (ESC \).
                chars.next(); // consume ']'
                consume_until_st_or_bel(&mut chars);
            }
            Some(&'P') | Some(&'X') | Some(&'^') | Some(&'_') => {
                // String-type sequences: DCS (ESC P), SOS (ESC X),
                // PM (ESC ^), APC (ESC _).
                // Payload ends at ST (ESC \); also accept BEL as a
                // lenient terminator (mirrors OSC handling above).
                chars.next(); // consume introducer
                consume_until_st_or_bel(&mut chars);
            }
            Some(_) => {
                // Other ESC + single char (e.g. ESC M, ESC =, etc.) — consume
                // that one character and move on.
                chars.next();
            }
            None => {} // bare ESC at end of string
        }
    }
    output
}

/// Consume characters until ST (ESC `\`) or BEL (`\x07`) is reached,
/// or until the input is exhausted (unterminated sequence).
fn consume_until_st_or_bel(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) {
    loop {
        match chars.next() {
            None | Some('\x07') => break,
            Some('\u{1b}') => {
                // ST = ESC '\'
                if chars.peek() == Some(&'\\') {
                    chars.next(); // consume '\'
                }
                break;
            }
            _ => {} // consume payload byte
        }
    }
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
            classify_scrollback("thinking...\nesc to interrupt", Some(now - 500), now, None).activity,
            AgentActivity::Working,
        );
        assert_eq!(
            classify_scrollback("Allow command to run?\nApprove with y/n", Some(now - 500), now, None)
                .activity,
            AgentActivity::Waiting,
        );
        assert_eq!(
            classify_scrollback("all done\n~/project $ ", Some(now - 30_000), now, None).activity,
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
            classify_scrollback(&scrollback, Some(now - 30_000), now, None).activity,
            AgentActivity::Idle,
        );
    }

    #[test]
    fn classify_scrollback_keeps_recent_generic_output_unknown() {
        let now = 12_000;

        assert_eq!(
            classify_scrollback("cargo check\nCompiling crate", Some(now - 500), now, None).activity,
            AgentActivity::Unknown,
        );
    }

    #[test]
    fn classify_scrollback_stays_working_through_quiet_think_gap() {
        let now = 100_000;
        // Marker has scrolled out and output paused for 4s, but the agent was
        // working 3s ago — within the quiet grace window, so it holds green.
        let scrollback = "Read 12 files\nsearching the codebase".to_string();
        let verdict = classify_scrollback(&scrollback, Some(now - 4_000), now, Some(now - 3_000));
        assert_eq!(verdict.activity, AgentActivity::Working);
        // Stamp is preserved (not advanced) so stickiness still ages out later.
        assert_eq!(verdict.last_working_at, Some(now - 3_000));
    }

    #[test]
    fn classify_scrollback_stays_working_through_large_tool_dump() {
        let now = 100_000;
        let dump = (0..200)
            .map(|index| format!("match {index}: src/file_{index}.rs"))
            .collect::<Vec<_>>()
            .join("\n");
        // Output still streaming (fresh) but the interrupt marker scrolled past the
        // tail. Working seen 10s ago → still within the sticky window.
        let verdict = classify_scrollback(&dump, Some(now - 1_000), now, Some(now - 10_000));
        assert_eq!(verdict.activity, AgentActivity::Working);
    }

    #[test]
    fn classify_scrollback_drops_working_after_sticky_window_expires() {
        let now = 100_000;
        // Quiet for 30s and last working stamp is 30s old → past the grace window,
        // sitting on a prompt → idle.
        let verdict =
            classify_scrollback("done\n~/project $ ", Some(now - 30_000), now, Some(now - 30_000));
        assert_eq!(verdict.activity, AgentActivity::Idle);
        assert_eq!(verdict.last_working_at, None);
    }

    #[test]
    fn parse_claude_agents_json_is_defensive_about_shape() {
        let records = parse_claude_agents_json(
            r#"[
                { "pid": 12171, "cwd": "/tmp/project", "kind": "interactive", "status": "busy" },
                { "cwd": "/tmp/project", "status": "waiting", "summary": "Needs approval" },
                { "workingDirectory": "/tmp/other", "done": 2, "total": 5 },
                { "projectPath": "/tmp/finished", "status": "complete" },
                { "unexpected": true }
            ]"#,
        )
        .expect("json should parse");

        assert_eq!(records.len(), 4);
        // `busy` is the live status reported for a working interactive session.
        assert_eq!(records[0].pid, Some(12171));
        assert_eq!(records[0].cwd.as_deref(), Some("/tmp/project"));
        assert_eq!(records[0].activity, AgentActivity::Working);
        assert_eq!(records[1].activity, AgentActivity::Waiting);
        assert_eq!(records[1].detail, None);
        assert_eq!(records[2].activity, AgentActivity::Working);
        assert_eq!(records[3].activity, AgentActivity::Idle);
    }

    #[test]
    fn claude_waiting_escalation_detects_prompts_without_false_positives() {
        fn probe_with(scrollback: &str) -> StatusProbe {
            StatusProbe {
                registration: AgentTerminalRegistration {
                    terminal_id: String::from("term-1"),
                    pty_id: String::from("pty-1"),
                    cwd: None,
                    workspace_root: None,
                },
                probe: Some(PtyAgentProbe {
                    cwd: None,
                    foreground_process_group: None,
                    scrollback: scrollback.to_string(),
                    last_output_at: None,
                }),
                kind: AgentKind::Claude,
                process_cwd: None,
            }
        }

        // A real approval prompt escalates a `busy` session to `waiting`.
        assert_eq!(
            escalate_claude_activity(
                AgentActivity::Working,
                &probe_with("Editing src/lib.rs\nDo you want to proceed?"),
            ),
            AgentActivity::Waiting,
        );
        // Ordinary command output must not read as waiting.
        assert_eq!(
            escalate_claude_activity(
                AgentActivity::Working,
                &probe_with("git push\nfatal: Permission denied (publickey)"),
            ),
            AgentActivity::Working,
        );
        assert_eq!(
            escalate_claude_activity(
                AgentActivity::Working,
                &probe_with("CI: build approved\nrunning tests"),
            ),
            AgentActivity::Working,
        );
    }

    #[test]
    fn pid_correlation_disambiguates_sessions_sharing_a_cwd() {
        let records = vec![
            ClaudeAgentRecord {
                pid: Some(10931),
                cwd: Some(String::from("/tmp/project")),
                activity: AgentActivity::Idle,
                detail: None,
            },
            ClaudeAgentRecord {
                pid: Some(12171),
                cwd: Some(String::from("/tmp/project")),
                activity: AgentActivity::Working,
                detail: None,
            },
        ];

        let matched = correlate_claude_record_by_pid(12171, &records).expect("pid should match");
        assert_eq!(matched.activity, AgentActivity::Working);
        assert!(correlate_claude_record_by_pid(99999, &records).is_none());
    }

    #[test]
    fn claude_cwd_correlation_refuses_ambiguous_terminals() {
        let status = correlate_claude_record(
            "/tmp/project",
            &[String::from("/tmp/project"), String::from("/tmp/project")],
            &[ClaudeAgentRecord {
                pid: None,
                cwd: Some(String::from("/tmp/project")),
                activity: AgentActivity::Working,
                detail: Some(String::from("editing")),
            }],
        );

        assert!(status.is_none());
    }

    #[test]
    fn claude_ambiguous_cwd_without_pid_or_probe_is_unknown() {
        // No probe (so no pid and no scrollback) and two sessions share the cwd:
        // cwd correlation is ambiguous, so it falls through to scrollback which has
        // nothing to read → unknown rather than a wrong guess.
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
                pid: Some(111),
                cwd: Some(String::from("/tmp/project")),
                activity: AgentActivity::Working,
                detail: None,
            },
            ClaudeAgentRecord {
                pid: Some(222),
                cwd: Some(String::from("/tmp/project")),
                activity: AgentActivity::Waiting,
                detail: None,
            },
        ];

        let (status, working_at) = status_from_probe(
            &probe,
            &[String::from("/tmp/project")],
            &records,
            0,
            None,
            10,
            None,
        );

        assert_eq!(status.activity, AgentActivity::Unknown);
        assert_eq!(status.source, AgentStatusSource::None);
        assert_eq!(working_at, None);
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

    // ── strip_ansi tests ─────────────────────────────────────────────────────

    #[test]
    fn strip_ansi_removes_csi_sequences() {
        // Standard color/attribute codes.
        assert_eq!(strip_ansi("\x1b[31mred\x1b[0m"), "red");
        assert_eq!(strip_ansi("\x1b[1;32mbold green\x1b[m"), "bold green");
    }

    #[test]
    fn strip_ansi_removes_osc_title_bel_terminated() {
        // OSC 0 title: "\x1b]0;/home/user/project\x07" — the original bug
        // left "ome/user/project\x07" in the output.
        let input = "\x1b]0;/home/user/project\x07visible text";
        assert_eq!(strip_ansi(input), "visible text");
    }

    #[test]
    fn strip_ansi_removes_osc_7_st_terminated() {
        // OSC 7 cwd notification terminated by ST (ESC \).
        let input = "\x1b]7;file:///Users/dev/project\x1b\\after";
        assert_eq!(strip_ansi(input), "after");
    }

    #[test]
    fn strip_ansi_removes_osc_then_csi_then_text() {
        // Mixed sequence: title, CSI reset, then plain text.
        let input = "\x1b]0;my-title\x07\x1b[0mclean";
        assert_eq!(strip_ansi(input), "clean");
    }

    #[test]
    fn strip_ansi_bare_esc_consumes_one_char() {
        // ESC M (reverse index), ESC = (application keypad), etc.
        assert_eq!(strip_ansi("\x1b=text"), "text");
        assert_eq!(strip_ansi("\x1bMtext"), "text");
    }

    #[test]
    fn strip_ansi_plain_text_unchanged() {
        assert_eq!(strip_ansi("hello world"), "hello world");
    }

    #[test]
    fn strip_ansi_preserves_text_around_sequences() {
        let input = "before\x1b[32mgreen text\x1b[0mafter";
        assert_eq!(strip_ansi(input), "beforegreen textafter");
    }

    #[test]
    fn strip_ansi_osc_at_end_of_string_no_panic() {
        // Unterminated OSC — should consume to end without panicking.
        let input = "text\x1b]0;unterminated";
        assert_eq!(strip_ansi(input), "text");
    }

    #[test]
    fn strip_ansi_removes_dcs_payload() {
        // DCS (ESC P) terminated by ST (ESC \) — payload must be dropped.
        let input = "before\x1bPsome dcs data\x1b\\after";
        assert_eq!(strip_ansi(input), "beforeafter");
        // Also verify BEL terminates DCS.
        let input2 = "before\x1bPsome dcs data\x07after";
        assert_eq!(strip_ansi(input2), "beforeafter");
    }

    #[test]
    fn strip_ansi_removes_apc_payload() {
        // APC (ESC _) — tmux passthrough style: ESC _ payload ESC \
        let input = "start\x1b_tmux passthrough payload\x1b\\end";
        assert_eq!(strip_ansi(input), "startend");
        // PM (ESC ^) — same ST termination.
        let input2 = "start\x1b^pm payload\x1b\\end";
        assert_eq!(strip_ansi(input2), "startend");
        // SOS (ESC X) — same ST termination.
        let input3 = "start\x1bXsos payload\x1b\\end";
        assert_eq!(strip_ansi(input3), "startend");
    }

    #[test]
    fn strip_ansi_unterminated_dcs_at_end_of_string() {
        // DCS with no closing ST — payload consumed to end, no panic, no output.
        let input = "before\x1bPunterminated dcs payload";
        assert_eq!(strip_ansi(input), "before");
    }
}
