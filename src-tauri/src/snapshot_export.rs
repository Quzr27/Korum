use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

const MAX_SNAPSHOT_PNG_BYTES: usize = 32 * 1024 * 1024;
const PNG_SIGNATURE: &[u8] = &[137, 80, 78, 71, 13, 10, 26, 10];

pub fn save_snapshot_png_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("Snapshot PNG payload is empty".to_string());
    }
    if bytes.len() > MAX_SNAPSHOT_PNG_BYTES {
        return Err("Snapshot PNG payload is too large".to_string());
    }
    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err("Snapshot payload must be a PNG image".to_string());
    }
    if !path.is_absolute() {
        return Err("Snapshot path must be absolute".to_string());
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("png") {
        return Err("Snapshot path must use a PNG extension".to_string());
    }

    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            return Err("Snapshot path must not be a symlink".to_string());
        }
        if !metadata.file_type().is_file() {
            return Err("Snapshot path must point to a file".to_string());
        }
    }

    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .ok_or_else(|| "Snapshot path must have a parent directory".to_string())?;
    let parent_metadata = fs::metadata(parent)
        .map_err(|err| format!("Failed to inspect snapshot directory: {err}"))?;
    if !parent_metadata.is_dir() {
        return Err("Snapshot path parent must be a directory".to_string());
    }

    let temp_path = temp_snapshot_path(parent);
    let write_result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|err| format!("Failed to create snapshot temp file: {err}"))?;
        file.write_all(bytes)
            .map_err(|err| format!("Failed to write snapshot PNG: {err}"))?;
        file.sync_all()
            .map_err(|err| format!("Failed to flush snapshot PNG: {err}"))?;
        drop(file);
        fs::rename(&temp_path, path)
            .map_err(|err| format!("Failed to save snapshot PNG: {err}"))?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

fn temp_snapshot_path(parent: &Path) -> PathBuf {
    parent.join(format!(".korum-snapshot-{}.tmp", Uuid::new_v4()))
}

pub fn reveal_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Snapshot path must be absolute".to_string());
    }
    if !path.exists() {
        return Err("Snapshot file does not exist".to_string());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg("-R").arg(path);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(format!("/select,{}", path.display()));
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path.parent().unwrap_or_else(|| Path::new(".")));
        command
    };

    command
        .spawn()
        .map_err(|err| format!("Failed to reveal snapshot: {err}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{save_snapshot_png_bytes, MAX_SNAPSHOT_PNG_BYTES};
    use std::fs;

    fn temp_png_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("korum-snapshot-export-{name}.png"))
    }

    fn png_bytes() -> &'static [u8] {
        &[137, 80, 78, 71, 13, 10, 26, 10]
    }

    #[test]
    fn save_snapshot_png_bytes_writes_png_file() {
        let path = temp_png_path("writes");
        let _ = fs::remove_file(&path);

        save_snapshot_png_bytes(&path, png_bytes()).expect("save png");

        assert_eq!(fs::read(&path).expect("read png"), png_bytes());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn save_snapshot_png_bytes_rejects_empty_payload() {
        let path = temp_png_path("empty");

        let error = save_snapshot_png_bytes(&path, &[]).expect_err("empty payload should fail");

        assert!(error.contains("empty"));
    }

    #[test]
    fn save_snapshot_png_bytes_rejects_non_png_extension() {
        let path = std::env::temp_dir().join("korum-snapshot-export.txt");

        let error = save_snapshot_png_bytes(&path, png_bytes()).expect_err("non-png should fail");

        assert!(error.contains("PNG"));
    }

    #[test]
    fn save_snapshot_png_bytes_rejects_relative_paths() {
        let error = save_snapshot_png_bytes(std::path::Path::new("snapshot.png"), png_bytes())
            .expect_err("relative paths should fail");

        assert!(error.contains("absolute"));
    }

    #[test]
    fn save_snapshot_png_bytes_rejects_invalid_png_payloads() {
        let path = temp_png_path("invalid-payload");
        let _ = fs::remove_file(&path);

        let error = save_snapshot_png_bytes(&path, b"not a png")
            .expect_err("invalid png should fail");

        assert!(error.contains("PNG"));
        assert!(!path.exists());
    }

    #[test]
    fn save_snapshot_png_bytes_rejects_large_payloads() {
        let path = temp_png_path("too-large");
        let bytes = vec![0; MAX_SNAPSHOT_PNG_BYTES + 1];

        let error = save_snapshot_png_bytes(&path, &bytes)
            .expect_err("large payload should fail");

        assert!(error.contains("too large"));
    }

    #[cfg(unix)]
    #[test]
    fn save_snapshot_png_bytes_rejects_symlink_targets() {
        use std::os::unix::fs::symlink;

        let target = temp_png_path("symlink-target");
        let link = temp_png_path("symlink-link");
        let _ = fs::remove_file(&target);
        let _ = fs::remove_file(&link);
        fs::write(&target, b"existing").expect("write target");
        symlink(&target, &link).expect("create symlink");

        let error = save_snapshot_png_bytes(&link, png_bytes())
            .expect_err("symlink paths should fail");

        assert!(error.contains("symlink"));
        assert_eq!(fs::read(&target).expect("read target"), b"existing");
        let _ = fs::remove_file(link);
        let _ = fs::remove_file(target);
    }
}
