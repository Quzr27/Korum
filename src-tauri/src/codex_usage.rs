use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use crate::claude_usage::HTTP_CLIENT;

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_URL: &str = "https://auth.openai.com/oauth/token";
const REFRESH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";

// ── Public response types (serialized to frontend) ──

#[derive(Serialize, Default)]
pub struct CodexUsageResponse {
    pub primary_window: Option<CodexUsageBucket>,
    pub secondary_window: Option<CodexUsageBucket>,
    pub plan_type: Option<String>,
}

#[derive(Serialize, Default, Clone)]
pub struct CodexUsageBucket {
    pub utilization: f64,
    pub resets_at: Option<String>,
}

// ── Internal credential types ──

#[derive(Deserialize)]
struct AuthFile {
    tokens: Option<AuthTokens>,
}

#[derive(Deserialize, Clone)]
struct AuthTokens {
    access_token: String,
    refresh_token: String,
    account_id: Option<String>,
}

#[derive(Deserialize)]
struct RefreshResponse {
    access_token: String,
    refresh_token: Option<String>,
}

// ── Internal API response ──

#[derive(Deserialize)]
struct ApiUsageResponse {
    plan_type: Option<String>,
    rate_limit: Option<ApiRateLimit>,
}

#[derive(Deserialize)]
struct ApiRateLimit {
    primary_window: Option<ApiWindow>,
    secondary_window: Option<ApiWindow>,
}

#[derive(Deserialize)]
struct ApiWindow {
    used_percent: Option<f64>,
    reset_after_seconds: Option<f64>,
}

enum UsageError {
    Unauthorized,
    Other(String),
}

// ── Public API ──

pub async fn fetch_usage() -> Result<CodexUsageResponse, String> {
    let (auth_path, raw, tokens) =
        tauri::async_runtime::spawn_blocking(read_credentials)
            .await
            .map_err(|e| format!("Credential read task failed: {e}"))??;

    match request_usage(&tokens.access_token, &tokens.account_id).await {
        Ok(api) => Ok(build_response(api)),
        Err(UsageError::Unauthorized) => {
            let new_token = refresh_token_flow(&tokens, &auth_path, &raw).await?;
            let api = request_usage(&new_token, &tokens.account_id)
                .await
                .map_err(|e| match e {
                    UsageError::Unauthorized => "Unauthorized after token refresh".to_string(),
                    UsageError::Other(msg) => msg,
                })?;
            Ok(build_response(api))
        }
        Err(UsageError::Other(msg)) => Err(msg),
    }
}

// ── Credential reading (blocking — called via spawn_blocking) ──

fn read_credentials() -> Result<(PathBuf, String, AuthTokens), String> {
    let auth_path = auth_path()?;
    let raw = fs::read_to_string(&auth_path)
        .map_err(|_| "Codex credentials not found".to_string())?;
    let auth: AuthFile =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid Codex auth JSON: {e}"))?;
    let tokens = auth.tokens.ok_or("No tokens in Codex auth")?;
    Ok((auth_path, raw, tokens))
}

fn auth_path() -> Result<PathBuf, String> {
    let base = if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        PathBuf::from(codex_home)
    } else {
        let home = std::env::var("HOME").map_err(|_| "Codex credentials not found")?;
        PathBuf::from(home).join(".codex")
    };
    Ok(base.join("auth.json"))
}

// ── HTTP ──

async fn request_usage(
    token: &str,
    account_id: &Option<String>,
) -> Result<ApiUsageResponse, UsageError> {
    let mut req = HTTP_CLIENT
        .get(USAGE_URL)
        .bearer_auth(token);

    if let Some(id) = account_id {
        req = req.header("ChatGPT-Account-ID", id);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| UsageError::Other(format!("HTTP request failed: {e}")))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED
        || resp.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(UsageError::Unauthorized);
    }
    if !resp.status().is_success() {
        return Err(UsageError::Other(format!("API returned {}", resp.status())));
    }

    resp.json::<ApiUsageResponse>()
        .await
        .map_err(|e| UsageError::Other(format!("Failed to parse Codex usage: {e}")))
}

async fn refresh_token_flow(
    tokens: &AuthTokens,
    auth_path: &PathBuf,
    original_raw: &str,
) -> Result<String, String> {
    let resp = HTTP_CLIENT
        .post(REFRESH_URL)
        .json(&serde_json::json!({
            "client_id": REFRESH_CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": tokens.refresh_token,
        }))
        .send()
        .await
        .map_err(|e| format!("Codex token refresh failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Codex token refresh returned {}", resp.status()));
    }

    let refresh: RefreshResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid Codex refresh response: {e}"))?;

    // Atomic write back to auth.json (via spawn_blocking for file I/O)
    let path = auth_path.clone();
    let raw = original_raw.to_string();
    let new_access = refresh.access_token.clone();
    let new_refresh = refresh.refresh_token.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(t) = value.get_mut("tokens") {
                t["access_token"] = serde_json::Value::String(new_access);
                if let Some(rt) = new_refresh {
                    t["refresh_token"] = serde_json::Value::String(rt);
                }
            }
            let now_secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            value["last_refresh"] = serde_json::Value::String(format_unix_as_iso(now_secs));

            if let Ok(json_str) = serde_json::to_string_pretty(&value) {
                let tmp_path = path.with_file_name("auth.json.tmp");
                if fs::write(&tmp_path, &json_str).is_ok() {
                    let _ = fs::rename(&tmp_path, &path);
                }
            }
        }
    })
    .await;

    Ok(refresh.access_token)
}

// ── Date formatting ──

fn build_response(api: ApiUsageResponse) -> CodexUsageResponse {
    let rl = api.rate_limit.as_ref();
    CodexUsageResponse {
        primary_window: rl
            .and_then(|r| r.primary_window.as_ref())
            .map(window_to_bucket),
        secondary_window: rl
            .and_then(|r| r.secondary_window.as_ref())
            .map(window_to_bucket),
        plan_type: api.plan_type,
    }
}

fn window_to_bucket(w: &ApiWindow) -> CodexUsageBucket {
    let raw = w.reset_after_seconds.unwrap_or(0.0);
    let reset_secs = if raw.is_finite() { raw.clamp(0.0, 86400.0 * 365.0 * 10.0) } else { 0.0 };
    let reset_at = if reset_secs > 0.0 {
        let future_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs() as i64
            + reset_secs as i64;
        Some(format_unix_as_iso(future_secs))
    } else {
        None
    };

    CodexUsageBucket {
        utilization: w.used_percent.unwrap_or(0.0),
        resets_at: reset_at,
    }
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

    let mut y = 1970i64;
    let mut remaining = days_since_epoch;
    loop {
        if y > 9999 { return String::new(); }
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining < days_in_year { break; }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize;
    while m < 12 && remaining >= month_days[m] {
        remaining -= month_days[m];
        m += 1;
    }

    format!(
        "{y:04}-{:02}-{:02}T{hours:02}:{minutes:02}:{seconds:02}Z",
        m + 1,
        remaining + 1,
    )
}
