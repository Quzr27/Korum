use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

const APP_SERVER_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_STDOUT_BYTES: usize = 1024 * 1024;
const INITIALIZE_ID: i64 = 0;
const RATE_LIMITS_ID: i64 = 7;

#[derive(Serialize, Default, Debug)]
pub struct CodexUsageResponse {
    pub limits: Vec<CodexUsageLimit>,
    pub rate_limit_reset_credits: Option<i64>,
}

#[derive(Serialize, Default, Debug)]
pub struct CodexUsageLimit {
    pub limit_id: Option<String>,
    pub limit_name: Option<String>,
    pub primary_window: Option<CodexUsageBucket>,
    pub secondary_window: Option<CodexUsageBucket>,
    pub credits: Option<CodexCredits>,
    pub individual_limit: Option<CodexIndividualLimit>,
    pub plan_type: Option<String>,
    pub rate_limit_reached_type: Option<String>,
}

#[derive(Serialize, Default, Debug)]
pub struct CodexUsageBucket {
    pub utilization: f64,
    pub resets_at: Option<String>,
    pub window_duration_minutes: Option<i64>,
}

#[derive(Serialize, Default, Debug)]
pub struct CodexCredits {
    pub has_credits: bool,
    pub unlimited: bool,
    pub balance: Option<String>,
}

#[derive(Serialize, Default, Debug)]
pub struct CodexIndividualLimit {
    pub limit: String,
    pub used: String,
    pub remaining_percent: f64,
    pub resets_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRateLimitsReadResult {
    rate_limits: RawRateLimit,
    rate_limits_by_limit_id: Option<BTreeMap<String, RawRateLimit>>,
    rate_limit_reset_credits: Option<RawRateLimitResetCredits>,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RawRateLimit {
    limit_id: Option<String>,
    limit_name: Option<String>,
    primary: Option<RawWindow>,
    secondary: Option<RawWindow>,
    credits: Option<RawCredits>,
    individual_limit: Option<RawIndividualLimit>,
    plan_type: Option<String>,
    rate_limit_reached_type: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RawWindow {
    used_percent: f64,
    window_duration_mins: Option<i64>,
    resets_at: Option<i64>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RawCredits {
    has_credits: bool,
    unlimited: bool,
    balance: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RawIndividualLimit {
    limit: String,
    used: String,
    remaining_percent: f64,
    resets_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRateLimitResetCredits {
    available_count: i64,
}

pub async fn fetch_usage() -> Result<CodexUsageResponse, String> {
    tauri::async_runtime::spawn_blocking(query_app_server)
        .await
        .map_err(|error| format!("Codex usage task failed: {error}"))?
}

fn query_app_server() -> Result<CodexUsageResponse, String> {
    let deadline = Instant::now() + APP_SERVER_TIMEOUT;
    let mut command = Command::new("codex");
    command
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(path) = crate::agent_status::cli_env_path() {
        command.env("PATH", path);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Codex CLI is unavailable: {error}"))?;
    let result = communicate_with_app_server(&mut child, deadline);
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn communicate_with_app_server(
    child: &mut Child,
    deadline: Instant,
) -> Result<CodexUsageResponse, String> {
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Codex app-server stdin is unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Codex app-server stdout is unavailable".to_string())?;
    let receiver = spawn_stdout_reader(stdout);

    write_rpc(
        &mut stdin,
        &json!({
            "method": "initialize",
            "id": INITIALIZE_ID,
            "params": {
                "clientInfo": {
                    "name": "korum",
                    "title": "Korum",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        }),
    )?;
    read_rpc_result(&receiver, deadline, INITIALIZE_ID)?;

    write_rpc(&mut stdin, &json!({ "method": "initialized" }))?;
    write_rpc(
        &mut stdin,
        &json!({ "method": "account/rateLimits/read", "id": RATE_LIMITS_ID }),
    )?;
    let value = read_rpc_result(&receiver, deadline, RATE_LIMITS_ID)?;
    drop(stdin);
    parse_usage_result(value)
}

fn spawn_stdout_reader<R: Read + Send + 'static>(
    mut stdout: R,
) -> Receiver<Result<String, String>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        let mut pending = Vec::new();
        let mut total = 0usize;
        loop {
            let count = match stdout.read(&mut chunk) {
                Ok(0) => {
                    if !pending.is_empty() {
                        let line = String::from_utf8_lossy(&pending)
                            .trim_end_matches('\r')
                            .to_string();
                        let _ = sender.send(Ok(line));
                    }
                    break;
                }
                Ok(count) => count,
                Err(error) => {
                    let _ = sender.send(Err(format!(
                        "Failed to read Codex app-server output: {error}"
                    )));
                    break;
                }
            };
            total = total.saturating_add(count);
            if total > MAX_STDOUT_BYTES {
                let _ = sender.send(Err("Codex app-server response exceeded 1 MiB".to_string()));
                break;
            }
            for byte in &chunk[..count] {
                if *byte == b'\n' {
                    let line = String::from_utf8_lossy(&pending)
                        .trim_end_matches('\r')
                        .to_string();
                    pending.clear();
                    if sender.send(Ok(line)).is_err() {
                        return;
                    }
                } else {
                    pending.push(*byte);
                }
            }
        }
    });
    receiver
}

fn write_rpc(stdin: &mut impl Write, value: &Value) -> Result<(), String> {
    serde_json::to_writer(&mut *stdin, value)
        .map_err(|error| format!("Failed to encode Codex app-server request: {error}"))?;
    stdin
        .write_all(b"\n")
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Failed to write to Codex app-server: {error}"))
}

fn read_rpc_result(
    receiver: &Receiver<Result<String, String>>,
    deadline: Instant,
    request_id: i64,
) -> Result<Value, String> {
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or_else(|| "Codex app-server timed out".to_string())?;
        let line = receiver
            .recv_timeout(remaining)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => "Codex app-server timed out".to_string(),
                mpsc::RecvTimeoutError::Disconnected => {
                    "Codex app-server exited before returning usage".to_string()
                }
            })??;
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(result) = matching_rpc_result(&message, request_id) {
            return result;
        }
    }
}

fn matching_rpc_result(message: &Value, request_id: i64) -> Option<Result<Value, String>> {
    if message.get("id").and_then(Value::as_i64) != Some(request_id) {
        return None;
    }
    if let Some(error) = message.get("error") {
        let details = error
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| error.to_string());
        return Some(Err(classify_rpc_error(&details)));
    }
    Some(
        message
            .get("result")
            .cloned()
            .ok_or_else(|| "Codex app-server returned an empty result".to_string()),
    )
}

fn classify_rpc_error(details: &str) -> String {
    let normalized = details.to_ascii_lowercase();
    if normalized.contains("429")
        || normalized.contains("too many requests")
        || normalized.contains("rate limit exceeded")
    {
        "RATE_LIMITED".to_string()
    } else {
        format!("Codex app-server error: {details}")
    }
}

fn parse_usage_result(value: Value) -> Result<CodexUsageResponse, String> {
    let raw: RawRateLimitsReadResult = serde_json::from_value(value)
        .map_err(|error| format!("Invalid Codex rate-limits response: {error}"))?;
    let mut limits = Vec::new();
    let mut seen = HashSet::new();
    let mut canonical = raw.rate_limits;
    let by_id = raw.rate_limits_by_limit_id;

    if canonical.limit_id.is_none()
        && by_id
            .as_ref()
            .is_some_and(|limits| limits.contains_key("codex"))
    {
        canonical.limit_id = Some("codex".to_string());
    }
    let canonical_id = canonical.limit_id.clone();
    if let Some(id) = canonical_id.as_ref() {
        seen.insert(id.clone());
    }
    limits.push(convert_limit(canonical, None));

    if let Some(by_id) = by_id {
        for (map_id, mut limit) in by_id {
            let id = limit.limit_id.clone().unwrap_or_else(|| map_id.clone());
            if seen.insert(id.clone()) {
                limit.limit_id = Some(id);
                limits.push(convert_limit(limit, Some(map_id)));
            }
        }
    }

    Ok(CodexUsageResponse {
        limits,
        rate_limit_reset_credits: raw
            .rate_limit_reset_credits
            .map(|credits| credits.available_count),
    })
}

fn convert_limit(raw: RawRateLimit, fallback_id: Option<String>) -> CodexUsageLimit {
    CodexUsageLimit {
        limit_id: raw.limit_id.or(fallback_id),
        limit_name: raw.limit_name,
        primary_window: raw.primary.map(convert_window),
        secondary_window: raw.secondary.map(convert_window),
        credits: raw.credits.map(|credits| CodexCredits {
            has_credits: credits.has_credits,
            unlimited: credits.unlimited,
            balance: credits.balance,
        }),
        individual_limit: raw.individual_limit.map(|limit| CodexIndividualLimit {
            limit: limit.limit,
            used: limit.used,
            remaining_percent: limit.remaining_percent,
            resets_at: unix_timestamp(limit.resets_at),
        }),
        plan_type: raw.plan_type,
        rate_limit_reached_type: raw.rate_limit_reached_type,
    }
}

fn convert_window(raw: RawWindow) -> CodexUsageBucket {
    CodexUsageBucket {
        utilization: raw.used_percent,
        resets_at: raw.resets_at.and_then(unix_timestamp),
        window_duration_minutes: raw.window_duration_mins,
    }
}

fn unix_timestamp(seconds: i64) -> Option<String> {
    let formatted = format_unix_as_iso(seconds);
    (!formatted.is_empty()).then_some(formatted)
}

fn format_unix_as_iso(secs: i64) -> String {
    if secs < 0 {
        return String::new();
    }
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let mut year = 1970i64;
    let mut remaining = days_since_epoch;
    loop {
        if year > 9999 {
            return String::new();
        }
        let days_in_year = if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
            366
        } else {
            365
        };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        year += 1;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 0usize;
    while month < 12 && remaining >= month_days[month] {
        remaining -= month_days[month];
        month += 1;
    }

    format!(
        "{year:04}-{:02}-{:02}T{hours:02}:{minutes:02}:{seconds:02}Z",
        month + 1,
        remaining + 1,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_deduplicates_current_multi_limit_response() {
        let response = json!({
            "rateLimits": {
                "limitId": "codex",
                "limitName": "Codex",
                "primary": { "usedPercent": 17.5, "windowDurationMins": 10080, "resetsAt": 1783987200 },
                "secondary": null,
                "credits": { "hasCredits": true, "unlimited": false, "balance": "12.50" },
                "individualLimit": { "limit": "100", "used": "25", "remainingPercent": 75.0, "resetsAt": 1783987200 },
                "planType": "prolite",
                "rateLimitReachedType": null
            },
            "rateLimitsByLimitId": {
                "codex": {
                    "limitId": "codex",
                    "limitName": "Codex duplicate",
                    "primary": null,
                    "secondary": null,
                    "credits": null,
                    "individualLimit": null,
                    "planType": "prolite",
                    "rateLimitReachedType": null
                },
                "GPT-5.3-Codex-Spark": {
                    "limitId": "GPT-5.3-Codex-Spark",
                    "limitName": "GPT-5.3 Codex Spark",
                    "primary": { "usedPercent": 2, "windowDurationMins": 300, "resetsAt": null },
                    "secondary": null,
                    "credits": null,
                    "individualLimit": null,
                    "planType": "prolite",
                    "rateLimitReachedType": "primary"
                }
            },
            "rateLimitResetCredits": { "availableCount": 2, "credits": null }
        });

        let parsed = parse_usage_result(response).expect("valid response");
        assert_eq!(parsed.limits.len(), 2);
        assert_eq!(parsed.limits[0].limit_id.as_deref(), Some("codex"));
        assert_eq!(
            parsed.limits[0]
                .primary_window
                .as_ref()
                .and_then(|window| window.window_duration_minutes),
            Some(10080)
        );
        assert_eq!(
            parsed.limits[1].limit_id.as_deref(),
            Some("GPT-5.3-Codex-Spark")
        );
        assert_eq!(
            parsed.limits[1].rate_limit_reached_type.as_deref(),
            Some("primary")
        );
        assert_eq!(parsed.rate_limit_reset_credits, Some(2));
    }

    #[test]
    fn fills_limit_id_from_map_key() {
        let response = json!({
            "rateLimits": { "limitId": null, "limitName": null, "primary": null, "secondary": null, "credits": null, "individualLimit": null, "planType": null, "rateLimitReachedType": null },
            "rateLimitsByLimitId": { "spark": { "limitId": null, "limitName": "Spark", "primary": null, "secondary": null, "credits": null, "individualLimit": null, "planType": null, "rateLimitReachedType": null } },
            "rateLimitResetCredits": null
        });
        let parsed = parse_usage_result(response).expect("valid response");
        assert_eq!(parsed.limits[1].limit_id.as_deref(), Some("spark"));
    }

    #[test]
    fn deduplicates_anonymous_canonical_codex_limit() {
        let snapshot = json!({
            "limitId": null,
            "limitName": null,
            "primary": { "usedPercent": 4, "windowDurationMins": 10080, "resetsAt": null },
            "secondary": null,
            "credits": null,
            "individualLimit": null,
            "planType": "prolite",
            "rateLimitReachedType": null
        });
        let response = json!({
            "rateLimits": snapshot.clone(),
            "rateLimitsByLimitId": { "codex": snapshot },
            "rateLimitResetCredits": null
        });

        let parsed = parse_usage_result(response).expect("valid response");
        assert_eq!(parsed.limits.len(), 1);
        assert_eq!(parsed.limits[0].limit_id.as_deref(), Some("codex"));
    }

    #[test]
    fn stdout_reader_enforces_limit_before_a_newline() {
        let receiver = spawn_stdout_reader(std::io::Cursor::new(vec![b'x'; MAX_STDOUT_BYTES + 1]));
        let error = receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("reader result")
            .expect_err("oversize output");
        assert!(error.contains("exceeded 1 MiB"));
    }

    #[test]
    fn classifies_rpc_rate_limit_errors() {
        let result = matching_rpc_result(
            &json!({ "id": RATE_LIMITS_ID, "error": { "code": -32000, "message": "HTTP 429: too many requests" } }),
            RATE_LIMITS_ID,
        )
        .expect("matching response");
        assert_eq!(result.expect_err("error response"), "RATE_LIMITED");
    }
}
