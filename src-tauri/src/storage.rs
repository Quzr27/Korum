use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

/// Serializes all disk writes to prevent concurrent atomic_write races on the same tmp file.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn ensure_config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?;
    ensure_dir(&dir)?;
    Ok(dir)
}

/// Write data atomically: write to .tmp, fsync, rename over target.
fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    let mut file = fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
    file.write_all(data).map_err(|e| format!("write tmp: {e}"))?;
    file.sync_all().map_err(|e| format!("sync tmp: {e}"))?;
    drop(file);
    fs::rename(&tmp, path).map_err(|e| format!("rename tmp→target: {e}"))?;
    Ok(())
}

fn has_string_field(value: &serde_json::Value, key: &str) -> bool {
    value.get(key).and_then(serde_json::Value::as_str).is_some()
}

fn has_number_field(value: &serde_json::Value, key: &str) -> bool {
    value.get(key).is_some_and(serde_json::Value::is_number)
}

fn has_optional_string_field(value: &serde_json::Value, key: &str) -> bool {
    value
        .get(key)
        .is_none_or(|field| field.is_null() || field.is_string())
}

fn has_optional_number_field(value: &serde_json::Value, key: &str) -> bool {
    value
        .get(key)
        .is_none_or(|field| field.is_null() || field.is_number())
}

fn is_valid_workspace_shape(value: &serde_json::Value) -> bool {
    value.is_object()
        && has_string_field(value, "id")
        && has_string_field(value, "name")
        && has_string_field(value, "color")
        && has_string_field(value, "icon")
        && has_optional_string_field(value, "rootPath")
}

fn is_valid_window_shape(value: &serde_json::Value) -> bool {
    let Some(kind) = value.get("type").and_then(serde_json::Value::as_str) else {
        return false;
    };

    if kind != "terminal" && kind != "note" && kind != "code" {
        return false;
    }

    let base_valid = value.is_object()
        && has_string_field(value, "id")
        && has_string_field(value, "title")
        && has_string_field(value, "workspaceId")
        && has_number_field(value, "x")
        && has_number_field(value, "y")
        && has_number_field(value, "width")
        && has_number_field(value, "height")
        && has_number_field(value, "zIndex")
        && has_optional_number_field(value, "createdAt")
        && has_optional_number_field(value, "updatedAt");

    base_valid && match kind {
        "terminal" => {
            has_optional_string_field(value, "terminalId")
                && has_optional_string_field(value, "initialCwd")
        }
        "note" => {
            has_optional_string_field(value, "content")
                && has_optional_string_field(value, "sourcePath")
        }
        "code" => {
            has_string_field(value, "sourcePath")
                && has_optional_string_field(value, "viewMode")
        }
        _ => false,
    }
}

fn is_valid_viewport_shape(value: &serde_json::Value) -> bool {
    value.is_object()
        && has_number_field(value, "panX")
        && has_number_field(value, "panY")
        && has_number_field(value, "zoom")
}

fn is_valid_state_shape(value: &serde_json::Value) -> bool {
    let Some(workspaces) = value.get("workspaces").and_then(serde_json::Value::as_array) else {
        return false;
    };
    let Some(windows) = value.get("windows").and_then(serde_json::Value::as_array) else {
        return false;
    };
    let Some(viewports) = value.get("viewports").and_then(serde_json::Value::as_object) else {
        return false;
    };

    value.is_object()
        && value
            .get("activeWorkspaceId")
            .is_some_and(|field| field.is_null() || field.is_string())
        && has_number_field(value, "savedAt")
        && has_number_field(value, "nextZ")
        && workspaces.iter().all(is_valid_workspace_shape)
        && windows.iter().all(is_valid_window_shape)
        && viewports.values().all(is_valid_viewport_shape)
}

fn is_valid_settings_shape(value: &serde_json::Value) -> bool {
    value.is_object()
        && has_string_field(value, "theme")
        && has_string_field(value, "baseColor")
        && has_number_field(value, "radius")
        && has_string_field(value, "terminalFont")
        && has_number_field(value, "terminalFontSize")
        && has_string_field(value, "terminalTheme")
        && has_optional_string_field(value, "codeTheme") // new field — optional for backward compat
        && has_string_field(value, "canvasAtmosphere")
        && has_number_field(value, "zoomSpeed")
}

fn try_load_state_file(path: &Path) -> Option<serde_json::Value> {
    let data = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&data).ok()?;
    let version = value.get("version")?.as_u64()?;
    if version != 1 {
        eprintln!(
            "[storage] unsupported state version {version} in {}",
            path.display()
        );
        return None;
    }
    if !is_valid_state_shape(&value) {
        eprintln!("[storage] invalid state shape in {}", path.display());
        return None;
    }
    Some(value)
}

fn try_load_settings_file(path: &Path) -> Option<serde_json::Value> {
    let data = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&data).ok()?;
    if !is_valid_settings_shape(&value) {
        eprintln!("[storage] invalid settings shape in {}", path.display());
        return None;
    }
    Some(value)
}

// ── Path-based core functions (testable without Tauri AppHandle) ──

/// MUST be called with WRITE_LOCK held (or from tests which are single-threaded).
fn save_state_to_dir(dir: &Path, state: &serde_json::Value) -> Result<(), String> {
    ensure_dir(dir)?;
    let state_path = dir.join("state.json");
    let backup_path = dir.join("state.backup.json");

    // Promote current state.json to backup only if it's a loadable last-known-good state.
    if try_load_state_file(&state_path).is_some() {
        let _ = fs::copy(&state_path, &backup_path);
    }

    let data = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    atomic_write(&state_path, data.as_bytes())
}

fn load_state_from_dir(dir: &Path) -> Option<serde_json::Value> {
    let state_path = dir.join("state.json");
    let backup_path = dir.join("state.backup.json");

    // Try primary
    if let Some(value) = try_load_state_file(&state_path) {
        return Some(value);
    }

    // Try backup
    if let Some(value) = try_load_state_file(&backup_path) {
        eprintln!("[storage] primary state.json invalid or missing, restored from backup");
        return Some(value);
    }

    // Both invalid or missing → clean state
    None
}

/// MUST be called with WRITE_LOCK held (or from tests which are single-threaded).
fn save_settings_to_dir(dir: &Path, settings: &serde_json::Value) -> Result<(), String> {
    ensure_dir(dir)?;
    let settings_path = dir.join("settings.json");
    let backup_path = dir.join("settings.backup.json");

    // Promote current settings.json to backup only if it's a loadable settings payload.
    if try_load_settings_file(&settings_path).is_some() {
        let _ = fs::copy(&settings_path, &backup_path);
    }

    let data = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    atomic_write(&settings_path, data.as_bytes())
}

fn load_settings_from_dir(dir: &Path) -> Option<serde_json::Value> {
    let settings_path = dir.join("settings.json");
    let backup_path = dir.join("settings.backup.json");

    // Try primary
    if let Some(value) = try_load_settings_file(&settings_path) {
        return Some(value);
    }

    // Try backup
    if let Some(value) = try_load_settings_file(&backup_path) {
        eprintln!("[storage] primary settings.json invalid or missing, restored from backup");
        return Some(value);
    }

    None
}

// ── Public API (Tauri AppHandle wrappers) ──

pub fn save_state(app: &tauri::AppHandle, state: &serde_json::Value) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let dir = ensure_config_dir(app)?;
    save_state_to_dir(&dir, state)
}

pub fn load_state(app: &tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let dir = match config_dir(app) {
        Ok(d) => d,
        Err(_) => return Ok(None),
    };
    Ok(load_state_from_dir(&dir))
}

pub fn save_settings(app: &tauri::AppHandle, settings: &serde_json::Value) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let dir = ensure_config_dir(app)?;
    save_settings_to_dir(&dir, settings)
}

pub fn load_settings(app: &tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let dir = match config_dir(app) {
        Ok(d) => d,
        Err(_) => return Ok(None),
    };
    Ok(load_settings_from_dir(&dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("korum-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_state() -> serde_json::Value {
        serde_json::json!({
            "version": 1,
            "savedAt": 1712000000000_u64,
            "activeWorkspaceId": "ws-1",
            "nextZ": 5,
            "workspaces": [
                {
                    "id": "ws-1",
                    "name": "My Project",
                    "color": "blue",
                    "icon": "code",
                    "rootPath": "/Users/test/project"
                }
            ],
            "windows": [
                {
                    "id": "win-1",
                    "type": "terminal",
                    "x": 100,
                    "y": 200,
                    "width": 600,
                    "height": 400,
                    "zIndex": 1,
                    "title": "zsh",
                    "workspaceId": "ws-1",
                    "initialCwd": "/Users/test/project",
                    "createdAt": 1712000000000_u64,
                    "updatedAt": 1712000000000_u64
                },
                {
                    "id": "win-2",
                    "type": "note",
                    "x": 750,
                    "y": 200,
                    "width": 300,
                    "height": 300,
                    "zIndex": 2,
                    "title": "TODO",
                    "workspaceId": "ws-1",
                    "content": "Buy milk",
                    "createdAt": 1712000000000_u64,
                    "updatedAt": 1712000000000_u64
                }
            ],
            "viewports": {
                "ws-1": { "panX": -50.0, "panY": -100.0, "zoom": 1.2 }
            }
        })
    }

    fn sample_settings() -> serde_json::Value {
        serde_json::json!({
            "theme": "dark",
            "baseColor": "neutral",
            "radius": 0.625,
            "terminalFont": "JetBrains Mono",
            "terminalFontSize": 13,
            "terminalTheme": "arcadia-midnight",
            "canvasAtmosphere": "studio",
            "zoomSpeed": 1
        })
    }

    // ── atomic_write tests ──

    #[test]
    fn atomic_write_creates_file() {
        let dir = test_dir();
        let path = dir.join("test.json");
        atomic_write(&path, b"{\"hello\":\"world\"}").unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "{\"hello\":\"world\"}");
        // No .tmp left behind
        assert!(!dir.join("test.tmp").exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn atomic_write_overwrites_existing() {
        let dir = test_dir();
        let path = dir.join("test.json");
        atomic_write(&path, b"old").unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        fs::remove_dir_all(&dir).ok();
    }

    // ── try_load_state_file tests ──

    #[test]
    fn try_load_valid_state() {
        let dir = test_dir();
        let path = dir.join("state.json");
        let state = sample_state();
        fs::write(&path, serde_json::to_string(&state).unwrap()).unwrap();
        let loaded = try_load_state_file(&path);
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap()["version"], 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn try_load_wrong_version_returns_none() {
        let dir = test_dir();
        let path = dir.join("state.json");
        let state = serde_json::json!({ "version": 99 });
        fs::write(&path, serde_json::to_string(&state).unwrap()).unwrap();
        assert!(try_load_state_file(&path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn try_load_invalid_json_returns_none() {
        let dir = test_dir();
        let path = dir.join("state.json");
        fs::write(&path, "not json at all {{{").unwrap();
        assert!(try_load_state_file(&path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn try_load_missing_file_returns_none() {
        let dir = test_dir();
        let path = dir.join("nonexistent.json");
        assert!(try_load_state_file(&path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn try_load_no_version_field_returns_none() {
        let dir = test_dir();
        let path = dir.join("state.json");
        fs::write(&path, r#"{"workspaces":[]}"#).unwrap();
        assert!(try_load_state_file(&path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn try_load_invalid_state_shape_returns_none() {
        let dir = test_dir();
        let path = dir.join("state.json");
        let state = serde_json::json!({
            "version": 1,
            "savedAt": 1712000000000_u64,
            "activeWorkspaceId": "ws-1",
            "nextZ": 1,
            "workspaces": "not-an-array",
            "windows": [],
            "viewports": {}
        });
        fs::write(&path, serde_json::to_string(&state).unwrap()).unwrap();
        assert!(try_load_state_file(&path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    // ── State round-trip tests ──

    #[test]
    fn state_save_load_round_trip() {
        let dir = test_dir();
        let state = sample_state();
        save_state_to_dir(&dir, &state).unwrap();
        let loaded = load_state_from_dir(&dir).unwrap();
        assert_eq!(loaded, state);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn state_round_trip_preserves_all_fields() {
        let dir = test_dir();
        let state = sample_state();
        save_state_to_dir(&dir, &state).unwrap();
        let loaded = load_state_from_dir(&dir).unwrap();

        // Verify top-level fields
        assert_eq!(loaded["version"], 1);
        assert_eq!(loaded["activeWorkspaceId"], "ws-1");
        assert_eq!(loaded["nextZ"], 5);

        // Verify workspace fields
        let ws = &loaded["workspaces"][0];
        assert_eq!(ws["id"], "ws-1");
        assert_eq!(ws["name"], "My Project");
        assert_eq!(ws["color"], "blue");
        assert_eq!(ws["icon"], "code");
        assert_eq!(ws["rootPath"], "/Users/test/project");

        // Verify terminal window
        let tw = &loaded["windows"][0];
        assert_eq!(tw["type"], "terminal");
        assert_eq!(tw["x"], 100);
        assert_eq!(tw["y"], 200);
        assert_eq!(tw["width"], 600);
        assert_eq!(tw["height"], 400);
        assert_eq!(tw["initialCwd"], "/Users/test/project");

        // Verify note window
        let nw = &loaded["windows"][1];
        assert_eq!(nw["type"], "note");
        assert_eq!(nw["content"], "Buy milk");

        // Verify viewport
        let vp = &loaded["viewports"]["ws-1"];
        assert_eq!(vp["panX"], -50.0);
        assert_eq!(vp["panY"], -100.0);
        assert_eq!(vp["zoom"], 1.2);

        fs::remove_dir_all(&dir).ok();
    }

    // ── Corruption / fallback tests ──

    #[test]
    fn corrupted_primary_falls_back_to_backup() {
        let dir = test_dir();
        let state = sample_state();

        // Save valid state (creates state.json)
        save_state_to_dir(&dir, &state).unwrap();

        // Save again so the first save becomes the backup
        let state2 = serde_json::json!({
            "version": 1,
            "savedAt": 1712000001000_u64,
            "activeWorkspaceId": "ws-1",
            "nextZ": 6,
            "workspaces": [],
            "windows": [],
            "viewports": {}
        });
        save_state_to_dir(&dir, &state2).unwrap();

        // Now corrupt the primary
        fs::write(dir.join("state.json"), "CORRUPT{{{").unwrap();

        // Load should fall back to backup (which is the first save)
        let loaded = load_state_from_dir(&dir).unwrap();
        assert_eq!(loaded["nextZ"], 5); // original state's nextZ
        assert_eq!(loaded["activeWorkspaceId"], "ws-1");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn both_files_corrupted_returns_none() {
        let dir = test_dir();

        // Write corrupt data to both files
        fs::write(dir.join("state.json"), "NOT JSON").unwrap();
        fs::write(dir.join("state.backup.json"), "ALSO NOT JSON").unwrap();

        let loaded = load_state_from_dir(&dir);
        assert!(loaded.is_none());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn version_mismatch_returns_none() {
        let dir = test_dir();
        let bad_state = serde_json::json!({
            "version": 99,
            "workspaces": []
        });
        fs::write(
            dir.join("state.json"),
            serde_json::to_string(&bad_state).unwrap(),
        )
        .unwrap();

        let loaded = load_state_from_dir(&dir);
        assert!(loaded.is_none());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn version_mismatch_primary_falls_back_to_valid_backup() {
        let dir = test_dir();

        // Write a valid backup
        let valid = sample_state();
        fs::write(
            dir.join("state.backup.json"),
            serde_json::to_string_pretty(&valid).unwrap(),
        )
        .unwrap();

        // Write a version-2 primary
        let bad = serde_json::json!({ "version": 2, "workspaces": [] });
        fs::write(
            dir.join("state.json"),
            serde_json::to_string(&bad).unwrap(),
        )
        .unwrap();

        let loaded = load_state_from_dir(&dir).unwrap();
        assert_eq!(loaded["version"], 1);
        assert_eq!(loaded["activeWorkspaceId"], "ws-1");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn invalid_primary_shape_falls_back_to_valid_backup() {
        let dir = test_dir();
        let valid = sample_state();
        fs::write(
            dir.join("state.backup.json"),
            serde_json::to_string_pretty(&valid).unwrap(),
        )
        .unwrap();

        let invalid = serde_json::json!({
            "version": 1,
            "savedAt": 1712000000000_u64,
            "activeWorkspaceId": "ws-1",
            "nextZ": 1,
            "workspaces": {},
            "windows": [],
            "viewports": {}
        });
        fs::write(dir.join("state.json"), serde_json::to_string(&invalid).unwrap()).unwrap();

        let loaded = load_state_from_dir(&dir).unwrap();
        assert_eq!(loaded["activeWorkspaceId"], "ws-1");
        assert_eq!(loaded["windows"].as_array().unwrap().len(), 2);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_dir_returns_none() {
        let dir = test_dir();
        let loaded = load_state_from_dir(&dir);
        assert!(loaded.is_none());
        fs::remove_dir_all(&dir).ok();
    }

    // ── Backup promotion tests ──

    #[test]
    fn save_promotes_current_to_backup() {
        let dir = test_dir();
        let mut state1 = sample_state();
        state1["nextZ"] = serde_json::json!(11);
        let mut state2 = sample_state();
        state2["nextZ"] = serde_json::json!(22);

        save_state_to_dir(&dir, &state1).unwrap();
        assert!(!dir.join("state.backup.json").exists()); // no backup yet

        save_state_to_dir(&dir, &state2).unwrap();
        assert!(dir.join("state.backup.json").exists());

        // Backup should contain state1
        let backup: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("state.backup.json")).unwrap())
                .unwrap();
        assert_eq!(backup["nextZ"], 11);

        // Primary should contain state2
        let primary: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("state.json")).unwrap()).unwrap();
        assert_eq!(primary["nextZ"], 22);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_does_not_promote_invalid_json_to_backup() {
        let dir = test_dir();

        // Write garbage to state.json directly
        fs::write(dir.join("state.json"), "NOT VALID JSON").unwrap();

        // Save valid state — should NOT promote garbage to backup
        let state = sample_state();
        save_state_to_dir(&dir, &state).unwrap();

        // Backup should not exist (garbage was not promoted)
        assert!(!dir.join("state.backup.json").exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn existing_valid_backup_survives_invalid_primary() {
        let dir = test_dir();

        // Create a valid backup manually
        let good_backup = serde_json::json!({
            "version": 1,
            "savedAt": 1712000000000_u64,
            "activeWorkspaceId": null,
            "nextZ": 99,
            "workspaces": [],
            "windows": [],
            "viewports": {}
        });
        fs::write(
            dir.join("state.backup.json"),
            serde_json::to_string(&good_backup).unwrap(),
        )
        .unwrap();

        // Write garbage to primary
        fs::write(dir.join("state.json"), "CORRUPT DATA").unwrap();

        // Save new state — garbage primary should NOT overwrite good backup
        let new_state = serde_json::json!({ "version": 1, "marker": "new-save" });
        save_state_to_dir(&dir, &new_state).unwrap();

        // Backup should still be the original good backup (garbage was not promoted)
        let backup: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("state.backup.json")).unwrap())
                .unwrap();
        assert_eq!(backup["nextZ"], 99);

        // Primary should be the new save
        let primary: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("state.json")).unwrap()).unwrap();
        assert_eq!(primary["marker"], "new-save");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn existing_valid_backup_survives_unsupported_primary_version() {
        let dir = test_dir();

        let good_backup = serde_json::json!({
            "version": 1,
            "savedAt": 1712000000000_u64,
            "activeWorkspaceId": null,
            "nextZ": 88,
            "workspaces": [],
            "windows": [],
            "viewports": {}
        });
        fs::write(
            dir.join("state.backup.json"),
            serde_json::to_string(&good_backup).unwrap(),
        )
        .unwrap();

        fs::write(dir.join("state.json"), r#"{"version":99,"marker":"bad-primary"}"#).unwrap();

        let new_state = serde_json::json!({ "version": 1, "marker": "new-save" });
        save_state_to_dir(&dir, &new_state).unwrap();

        let backup: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("state.backup.json")).unwrap())
                .unwrap();
        assert_eq!(backup["nextZ"], 88);

        fs::remove_dir_all(&dir).ok();
    }

    // ── Atomic write verification ──

    #[test]
    fn atomic_write_no_tmp_left_behind() {
        let dir = test_dir();
        let path = dir.join("data.json");
        atomic_write(&path, b"test data").unwrap();

        // .tmp file should be cleaned up
        assert!(!dir.join("data.tmp").exists());
        assert!(path.exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_creates_config_dir_if_missing() {
        let root = std::env::temp_dir().join(format!(
            "korum-test-nested-{}",
            uuid::Uuid::new_v4()
        ));
        let dir = root.join("sub").join("dir");
        assert!(!dir.exists());

        let state = sample_state();
        save_state_to_dir(&dir, &state).unwrap();

        assert!(dir.join("state.json").exists());

        fs::remove_dir_all(&root).ok();
    }

    // ── Settings tests ──

    #[test]
    fn settings_save_load_round_trip() {
        let dir = test_dir();
        let settings = sample_settings();
        save_settings_to_dir(&dir, &settings).unwrap();
        let loaded = load_settings_from_dir(&dir).unwrap();
        assert_eq!(loaded, settings);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn settings_corrupted_primary_falls_back_to_backup() {
        let dir = test_dir();
        let settings = sample_settings();

        // Save twice so first becomes backup
        save_settings_to_dir(&dir, &settings).unwrap();
        let settings2 = serde_json::json!({
            "theme": "light",
            "baseColor": "zinc",
            "radius": 0.5,
            "terminalFont": "IBM Plex Mono",
            "terminalFontSize": 14,
            "terminalTheme": "dracula",
            "canvasAtmosphere": "aurora",
            "zoomSpeed": 1.5
        });
        save_settings_to_dir(&dir, &settings2).unwrap();

        // Corrupt primary
        fs::write(dir.join("settings.json"), "BROKEN").unwrap();

        let loaded = load_settings_from_dir(&dir).unwrap();
        assert_eq!(loaded["theme"], "dark"); // from backup (first save)

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn settings_both_corrupted_returns_none() {
        let dir = test_dir();
        fs::write(dir.join("settings.json"), "BAD").unwrap();
        fs::write(dir.join("settings.backup.json"), "ALSO BAD").unwrap();

        let loaded = load_settings_from_dir(&dir);
        assert!(loaded.is_none());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn settings_empty_dir_returns_none() {
        let dir = test_dir();
        let loaded = load_settings_from_dir(&dir);
        assert!(loaded.is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn settings_invalid_primary_shape_falls_back_to_valid_backup() {
        let dir = test_dir();
        let valid = sample_settings();
        fs::write(
            dir.join("settings.backup.json"),
            serde_json::to_string_pretty(&valid).unwrap(),
        )
        .unwrap();
        fs::write(dir.join("settings.json"), r#"{"theme":false}"#).unwrap();

        let loaded = load_settings_from_dir(&dir).unwrap();
        assert_eq!(loaded["theme"], "dark");
        assert_eq!(loaded["terminalFont"], "JetBrains Mono");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn settings_save_does_not_promote_invalid_shape_to_backup() {
        let dir = test_dir();
        let good_backup = serde_json::json!({
            "theme": "light",
            "baseColor": "zinc",
            "radius": 0.5,
            "terminalFont": "IBM Plex Mono",
            "terminalFontSize": 14,
            "terminalTheme": "dracula",
            "canvasAtmosphere": "mist",
            "zoomSpeed": 1.5
        });
        fs::write(
            dir.join("settings.backup.json"),
            serde_json::to_string(&good_backup).unwrap(),
        )
        .unwrap();
        fs::write(dir.join("settings.json"), r#"{"theme":false}"#).unwrap();

        let settings = sample_settings();
        save_settings_to_dir(&dir, &settings).unwrap();

        let backup: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("settings.backup.json")).unwrap())
                .unwrap();
        assert_eq!(backup["theme"], "light");
        assert_eq!(backup["terminalTheme"], "dracula");

        fs::remove_dir_all(&dir).ok();
    }

    // ── Workspace/window serialization round-trip ──

    #[test]
    fn multiple_workspaces_round_trip() {
        let dir = test_dir();
        let state = serde_json::json!({
            "version": 1,
            "savedAt": 1712000000000_u64,
            "activeWorkspaceId": "ws-2",
            "nextZ": 10,
            "workspaces": [
                { "id": "ws-1", "name": "Frontend", "color": "blue", "icon": "code", "rootPath": "/app/frontend" },
                { "id": "ws-2", "name": "Backend", "color": "green", "icon": "server", "rootPath": "/app/backend" },
                { "id": "ws-3", "name": "Scratch", "color": "orange", "icon": "terminal" }
            ],
            "windows": [
                { "id": "w1", "type": "terminal", "x": 0, "y": 0, "width": 800, "height": 600, "zIndex": 1, "title": "npm dev", "workspaceId": "ws-1" },
                { "id": "w2", "type": "terminal", "x": 850, "y": 0, "width": 800, "height": 600, "zIndex": 2, "title": "cargo watch", "workspaceId": "ws-2" },
                { "id": "w3", "type": "note", "x": 0, "y": 0, "width": 400, "height": 300, "zIndex": 3, "title": "Notes", "workspaceId": "ws-3", "content": "scratch pad" }
            ],
            "viewports": {
                "ws-1": { "panX": 0, "panY": 0, "zoom": 1.0 },
                "ws-2": { "panX": -200, "panY": -100, "zoom": 0.8 },
                "ws-3": { "panX": 50, "panY": 50, "zoom": 1.5 }
            }
        });

        save_state_to_dir(&dir, &state).unwrap();
        let loaded = load_state_from_dir(&dir).unwrap();

        assert_eq!(loaded["workspaces"].as_array().unwrap().len(), 3);
        assert_eq!(loaded["windows"].as_array().unwrap().len(), 3);
        assert_eq!(loaded["viewports"].as_object().unwrap().len(), 3);
        assert_eq!(loaded["activeWorkspaceId"], "ws-2");

        // Scratch workspace has no rootPath
        assert!(loaded["workspaces"][2].get("rootPath").is_none());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_state_round_trip() {
        let dir = test_dir();
        let state = serde_json::json!({
            "version": 1,
            "savedAt": 1712000000000_u64,
            "activeWorkspaceId": null,
            "nextZ": 1,
            "workspaces": [],
            "windows": [],
            "viewports": {}
        });

        save_state_to_dir(&dir, &state).unwrap();
        let loaded = load_state_from_dir(&dir).unwrap();
        assert_eq!(loaded, state);
        assert!(loaded["workspaces"].as_array().unwrap().is_empty());
        assert!(loaded["windows"].as_array().unwrap().is_empty());

        fs::remove_dir_all(&dir).ok();
    }

    // ── Successive saves ──

    #[test]
    fn multiple_successive_saves_maintain_integrity() {
        let dir = test_dir();

        for i in 0..5 {
            let state = serde_json::json!({
                "version": 1,
                "savedAt": 1712000000000_u64 + i as u64,
                "activeWorkspaceId": null,
                "nextZ": i,
                "workspaces": [],
                "windows": [],
                "viewports": {}
            });
            save_state_to_dir(&dir, &state).unwrap();
        }

        let loaded = load_state_from_dir(&dir).unwrap();
        assert_eq!(loaded["nextZ"], 4); // last save

        // Backup should be the second-to-last save
        let backup: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("state.backup.json")).unwrap())
                .unwrap();
        assert_eq!(backup["nextZ"], 3);

        fs::remove_dir_all(&dir).ok();
    }
}
