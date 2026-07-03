use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_LAYOUT_PACKAGE_BYTES: usize = 1024 * 1024;

pub fn save_layout_package_text(path: &Path, text: &str) -> Result<(), String> {
    validate_layout_package_path(path)?;
    if text.as_bytes().len() > MAX_LAYOUT_PACKAGE_BYTES {
        return Err("Layout package payload is too large".to_string());
    }
    serde_json::from_str::<serde_json::Value>(text)
        .map_err(|err| format!("Layout package payload must be JSON: {err}"))?;

    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            return Err("Layout package path must not be a symlink".to_string());
        }
        if !metadata.file_type().is_file() {
            return Err("Layout package path must point to a file".to_string());
        }
    }

    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .ok_or_else(|| "Layout package path must have a parent directory".to_string())?;
    let parent_metadata = fs::metadata(parent)
        .map_err(|err| format!("Failed to inspect layout package directory: {err}"))?;
    if !parent_metadata.is_dir() {
        return Err("Layout package parent must be a directory".to_string());
    }

    let temp_path = temp_layout_package_path(parent);
    let write_result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|err| format!("Failed to create layout package temp file: {err}"))?;
        file.write_all(text.as_bytes())
            .map_err(|err| format!("Failed to write layout package: {err}"))?;
        file.sync_all()
            .map_err(|err| format!("Failed to flush layout package: {err}"))?;
        drop(file);
        fs::rename(&temp_path, path)
            .map_err(|err| format!("Failed to save layout package: {err}"))?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

pub fn load_layout_package_text(path: &Path) -> Result<String, String> {
    validate_layout_package_path(path)?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|err| format!("Failed to inspect layout package: {err}"))?;
    if metadata.file_type().is_symlink() {
        return Err("Layout package path must not be a symlink".to_string());
    }
    if !metadata.file_type().is_file() {
        return Err("Layout package path must point to a file".to_string());
    }
    if metadata.len() as usize > MAX_LAYOUT_PACKAGE_BYTES {
        return Err("Layout package file is too large".to_string());
    }

    fs::read_to_string(path).map_err(|err| format!("Failed to read layout package: {err}"))
}

fn validate_layout_package_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Layout package path must be absolute".to_string());
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("json") {
        return Err("Layout package path must use a JSON extension".to_string());
    }
    Ok(())
}

fn temp_layout_package_path(parent: &Path) -> PathBuf {
    parent.join(format!(".korum-layout-{}.tmp", Uuid::new_v4()))
}

#[cfg(test)]
mod tests {
    use super::{load_layout_package_text, save_layout_package_text};
    use std::fs;
    use std::path::Path;
    use uuid::Uuid;

    fn temp_json_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "korum-layout-package-{name}-{}.json",
            Uuid::new_v4()
        ))
    }

    #[test]
    fn save_layout_package_text_writes_json_file() {
        let path = temp_json_path("writes");
        let _ = fs::remove_file(&path);

        save_layout_package_text(&path, r#"{"schema":"dev.quzr.korum.layout"}"#)
            .expect("save layout package");

        assert_eq!(
            fs::read_to_string(&path).expect("read layout package"),
            r#"{"schema":"dev.quzr.korum.layout"}"#
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn load_layout_package_text_reads_json_file() {
        let path = temp_json_path("reads");
        fs::write(&path, r#"{"ok":true}"#).expect("write layout package");

        let text = load_layout_package_text(&path).expect("load layout package");

        assert_eq!(text, r#"{"ok":true}"#);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn save_layout_package_text_rejects_relative_paths() {
        let error = save_layout_package_text(Path::new("layout.json"), "{}")
            .expect_err("relative paths should fail");

        assert!(error.contains("absolute"));
    }

    #[test]
    fn save_layout_package_text_rejects_non_json_extensions() {
        let path = std::env::temp_dir().join("korum-layout-package.txt");

        let error = save_layout_package_text(&path, "{}")
            .expect_err("non-json extension should fail");

        assert!(error.contains("JSON"));
    }

    #[test]
    fn load_layout_package_text_rejects_large_files() {
        let path = temp_json_path("large");
        fs::write(&path, "x".repeat(1_048_577)).expect("write large layout package");

        let error = load_layout_package_text(&path).expect_err("large package should fail");

        assert!(error.contains("too large"));
        let _ = fs::remove_file(path);
    }

    #[cfg(unix)]
    #[test]
    fn save_layout_package_text_rejects_symlink_targets() {
        use std::os::unix::fs::symlink;

        let target = temp_json_path("symlink-target");
        let link = temp_json_path("symlink-link");
        fs::write(&target, "{}").expect("write target");
        symlink(&target, &link).expect("create symlink");

        let error = save_layout_package_text(&link, "{}")
            .expect_err("symlink paths should fail");

        assert!(error.contains("symlink"));
        assert_eq!(fs::read_to_string(&target).expect("read target"), "{}");
        let _ = fs::remove_file(link);
        let _ = fs::remove_file(target);
    }
}
