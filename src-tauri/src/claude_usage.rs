use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::LazyLock;
use std::time::Duration;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const REFRESH_URL: &str = "https://platform.claude.com/v1/oauth/token";
const KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

pub(crate) static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .expect("failed to build HTTP client")
});

// ── Public response types (serialized to frontend) ──

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct UsageBucket {
    pub utilization: f64,
    // API may return `null` for resets_at on zero-utilization buckets.
    pub resets_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ExtraUsage {
    pub is_enabled: bool,
    pub monthly_limit: f64,
    pub used_credits: f64,
    pub utilization: f64,
    pub currency: String,
}

#[derive(Serialize, Default)]
pub struct UsageResponse {
    pub five_hour: Option<UsageBucket>,
    pub seven_day: Option<UsageBucket>,
    pub seven_day_opus: Option<UsageBucket>,
    pub seven_day_sonnet: Option<UsageBucket>,
    pub seven_day_oauth_apps: Option<UsageBucket>,
    pub extra_usage: Option<ExtraUsage>,
    pub subscription_type: Option<String>,
    pub rate_limit_tier: Option<String>,
}

// ── Internal credential types ──

#[derive(Deserialize)]
struct CredentialsFile {
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: Option<OAuthCredentials>,
}

#[derive(Deserialize, Clone)]
struct OAuthCredentials {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: String,
    #[serde(rename = "expiresAt")]
    expires_at: u64,
    #[serde(rename = "subscriptionType")]
    subscription_type: Option<String>,
    #[serde(rename = "rateLimitTier")]
    rate_limit_tier: Option<String>,
}

#[derive(Deserialize)]
struct RefreshResponse {
    access_token: String,
    expires_in: u64,
}

// ── Internal API response (may have extra fields) ──

#[derive(Deserialize)]
struct ApiUsageResponse {
    five_hour: Option<UsageBucket>,
    seven_day: Option<UsageBucket>,
    seven_day_opus: Option<UsageBucket>,
    seven_day_sonnet: Option<UsageBucket>,
    seven_day_oauth_apps: Option<UsageBucket>,
    extra_usage: Option<ExtraUsage>,
}

/// Tracks where credentials came from (affects whether we can write back).
enum CredentialSource {
    File(PathBuf),
    Keychain,
}

/// Typed error to distinguish auth/rate-limit failures from other errors.
enum UsageError {
    Unauthorized,
    RateLimited,
    Other(String),
}

// ── Public API ──

pub async fn fetch_usage() -> Result<UsageResponse, String> {
    let (raw, source) = tauri::async_runtime::spawn_blocking(read_credentials_raw)
        .await
        .map_err(|e| format!("Credential read task failed: {e}"))??;
    let file: CredentialsFile =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid credentials JSON: {e}"))?;
    let oauth = file
        .claude_ai_oauth
        .ok_or("No claudeAiOauth in credentials")?;

    // Try with current token first
    let token = if is_expired(&oauth) {
        refresh_token_flow(&oauth.refresh_token, &source, &raw).await?
    } else {
        oauth.access_token.clone()
    };

    match request_usage(&token).await {
        Ok(api) => Ok(build_response(api, &oauth)),
        Err(UsageError::RateLimited) => Err("RATE_LIMITED".to_string()),
        Err(UsageError::Unauthorized) => {
            let new_token =
                refresh_token_flow(&oauth.refresh_token, &source, &raw).await?;
            let api = request_usage(&new_token)
                .await
                .map_err(|e| match e {
                    UsageError::Unauthorized => "Unauthorized after token refresh".to_string(),
                    UsageError::RateLimited => "RATE_LIMITED".to_string(),
                    UsageError::Other(msg) => msg,
                })?;
            Ok(build_response(api, &oauth))
        }
        Err(UsageError::Other(msg)) => Err(msg),
    }
}

// ── Credential resolution: file → Keychain ──

fn read_credentials_raw() -> Result<(String, CredentialSource), String> {
    // 1. Try ~/.claude/.credentials.json
    if let Ok(home) = std::env::var("HOME") {
        let path = PathBuf::from(&home).join(".claude").join(".credentials.json");
        if let Ok(raw) = fs::read_to_string(&path) {
            return Ok((raw, CredentialSource::File(path)));
        }
    }

    // 2. Fallback: macOS Keychain via `security` CLI
    let output = Command::new("security")
        .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"])
        .output()
        .map_err(|e| format!("Keychain query failed: {e}"))?;

    if !output.status.success() {
        return Err("Claude credentials not found".to_string());
    }

    let raw = String::from_utf8(output.stdout)
        .map_err(|_| "Invalid Keychain data".to_string())?
        .trim()
        .to_string();

    Ok((raw, CredentialSource::Keychain))
}

fn is_expired(oauth: &OAuthCredentials) -> bool {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    oauth.expires_at <= now_ms
}

// ── HTTP ──

async fn request_usage(token: &str) -> Result<ApiUsageResponse, UsageError> {
    let resp = HTTP_CLIENT
        .get(USAGE_URL)
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .map_err(|e| UsageError::Other(format!("HTTP request failed: {e}")))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(UsageError::Unauthorized);
    }
    if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(UsageError::RateLimited);
    }
    if !resp.status().is_success() {
        return Err(UsageError::Other(format!("API returned {}", resp.status())));
    }

    resp.json::<ApiUsageResponse>()
        .await
        .map_err(|e| UsageError::Other(format!("Failed to parse usage response: {e}")))
}

async fn refresh_token_flow(
    refresh_token: &str,
    source: &CredentialSource,
    original_raw: &str,
) -> Result<String, String> {
    let resp = HTTP_CLIENT
        .post(REFRESH_URL)
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Token refresh returned {}", resp.status()));
    }

    let refresh: RefreshResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid refresh response: {e}"))?;

    // Only persist if credentials came from a file (we don't write back to Keychain)
    if let CredentialSource::File(creds_path) = source {
        let path = creds_path.clone();
        let raw = original_raw.to_string();
        let new_access = refresh.access_token.clone();
        let expires_in = refresh.expires_in;
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(oauth) = value.get_mut("claudeAiOauth") {
                    oauth["accessToken"] = serde_json::Value::String(new_access);
                    let new_expires = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0)
                        + expires_in * 1000;
                    oauth["expiresAt"] = serde_json::json!(new_expires);

                    if let Ok(json_str) = serde_json::to_string_pretty(&value) {
                        let tmp_path = path.with_file_name(".credentials.json.tmp");
                        if fs::write(&tmp_path, &json_str).is_ok() {
                            let _ = fs::rename(&tmp_path, &path);
                        }
                    }
                }
            }
        })
        .await;
    }

    Ok(refresh.access_token)
}

fn build_response(api: ApiUsageResponse, oauth: &OAuthCredentials) -> UsageResponse {
    UsageResponse {
        five_hour: api.five_hour,
        seven_day: api.seven_day,
        seven_day_opus: api.seven_day_opus,
        seven_day_sonnet: api.seven_day_sonnet,
        seven_day_oauth_apps: api.seven_day_oauth_apps,
        extra_usage: api.extra_usage,
        subscription_type: oauth.subscription_type.clone(),
        rate_limit_tier: oauth.rate_limit_tier.clone(),
    }
}
