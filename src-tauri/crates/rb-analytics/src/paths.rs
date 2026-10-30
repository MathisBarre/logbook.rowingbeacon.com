//! Where the app keeps its files (plan 2.12), computed without Tauri so the
//! MCP server (`--mcp`, no window) finds the same database as the app.
//!
//! - database: `dirs::config_dir()/<identifier>/main.db`, the folder of
//!   Tauri's `app_config_dir()`, where plugin-sql resolves `sqlite:main.db`.
//!   In demo mode (ADR 0009) the app opens `demo.db` in the same folder:
//!   the webview names the one it opened (`db_path_for`), among these two
//!   only. The MCP server always reads `main.db`;
//! - MCP inbox: `dirs::data_dir()/<identifier>/analytics-inbox/`;
//! - AI key files (fallback of the keychain), one per provider:
//!   `dirs::config_dir()/<identifier>/secrets/anthropic-api-key`,
//!   `…/secrets/openai-api-key`, `…/secrets/openai-compatible-connection`.

use std::path::PathBuf;

use crate::error::{AnalyticsError, ErrorCode};
use crate::ipc::{McpInfo, McpPlatform};

/// `identifier` of `tauri.conf.json` (a test compares them).
pub const APP_IDENTIFIER: &str = "com.rowing-beacon-tauri-app.app";

pub const DB_FILE_NAME: &str = "main.db";
/// The database of the demo mode (ADR 0009), next to `main.db`.
pub const DEMO_DB_FILE_NAME: &str = "demo.db";
pub const INBOX_DIR_NAME: &str = "analytics-inbox";
pub const KEY_FILE_NAME: &str = "anthropic-api-key";

fn config_root() -> Result<PathBuf, AnalyticsError> {
    dirs::config_dir()
        .map(|dir| dir.join(APP_IDENTIFIER))
        .ok_or_else(|| AnalyticsError::internal("No configuration folder for this user"))
}

pub fn db_path() -> Result<PathBuf, AnalyticsError> {
    Ok(config_root()?.join(DB_FILE_NAME))
}

/// The database the app has open: `main.db`, or `demo.db` in demo mode. The
/// webview sends the file name; only these two are accepted, never a path.
/// `None` is the club's `main.db` (MCP, calls from before demo mode).
pub fn db_path_for(database: Option<&str>) -> Result<PathBuf, AnalyticsError> {
    let name = match database {
        None | Some(DB_FILE_NAME) => DB_FILE_NAME,
        Some(DEMO_DB_FILE_NAME) => DEMO_DB_FILE_NAME,
        Some(other) => {
            return Err(AnalyticsError::new(
                ErrorCode::InvalidParam,
                format!("Unknown database \"{other}\": main.db or demo.db"),
            ))
        }
    };
    Ok(config_root()?.join(name))
}

pub fn inbox_dir() -> Result<PathBuf, AnalyticsError> {
    dirs::data_dir()
        .map(|dir| dir.join(APP_IDENTIFIER).join(INBOX_DIR_NAME))
        .ok_or_else(|| AnalyticsError::internal("No data folder for this user"))
}

pub fn key_file_path() -> Result<PathBuf, AnalyticsError> {
    secret_file_path(KEY_FILE_NAME)
}

/// `<config>/<identifier>/secrets/<name>`: the file fallback of a keychain
/// entry (`ai::key_store`).
pub fn secret_file_path(name: &str) -> Result<PathBuf, AnalyticsError> {
    Ok(config_root()?.join("secrets").join(name))
}

pub fn platform() -> McpPlatform {
    if cfg!(target_os = "windows") {
        McpPlatform::Windows
    } else if cfg!(target_os = "macos") {
        McpPlatform::Macos
    } else {
        McpPlatform::Linux
    }
}

/// Claude Desktop's config file; None on Linux, where it does not exist.
pub fn claude_desktop_config_path() -> Option<PathBuf> {
    match platform() {
        McpPlatform::Linux => None,
        // Windows: %APPDATA%; macOS: ~/Library/Application Support.
        _ => dirs::config_dir().map(|dir| dir.join("Claude").join("claude_desktop_config.json")),
    }
}

/// What Gestion › Statistiques et IA shows to set up Claude (WP7).
/// `exePath` is `$APPIMAGE` when set: an AppImage mounts at a new path at
/// every launch, so `current_exe()` would be stale.
pub fn mcp_info() -> Result<McpInfo, AnalyticsError> {
    let app_image = std::env::var_os("APPIMAGE").filter(|value| !value.is_empty());
    let exe_path = match &app_image {
        Some(path) => PathBuf::from(path),
        None => std::env::current_exe()
            .map_err(|e| AnalyticsError::internal(format!("current_exe: {e}")))?,
    };
    Ok(McpInfo {
        exe_path: exe_path.to_string_lossy().into_owned(),
        args: vec!["--mcp".to_string()],
        db_path: db_path()?.to_string_lossy().into_owned(),
        inbox_dir: inbox_dir()?.to_string_lossy().into_owned(),
        claude_desktop_config_path: claude_desktop_config_path()
            .map(|path| path.to_string_lossy().into_owned()),
        platform: platform(),
        is_app_image: app_image.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifier_matches_tauri_conf() {
        let conf: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tauri.conf.json"
        )))
        .unwrap();
        assert_eq!(conf["identifier"], APP_IDENTIFIER);
    }

    #[test]
    fn paths_end_with_the_expected_segments() {
        let Ok(db) = db_path() else {
            return; // No home folder in this environment.
        };
        assert!(db.ends_with(format!("{APP_IDENTIFIER}/main.db")));
        assert!(inbox_dir()
            .unwrap()
            .ends_with(format!("{APP_IDENTIFIER}/analytics-inbox")));
        assert!(key_file_path()
            .unwrap()
            .ends_with(format!("{APP_IDENTIFIER}/secrets/anthropic-api-key")));
        if let Some(path) = claude_desktop_config_path() {
            assert!(path.ends_with("Claude/claude_desktop_config.json"));
        }
    }

    #[test]
    fn the_app_database_is_main_or_demo_and_nothing_else() {
        let Ok(main) = db_path() else {
            return; // No home folder in this environment.
        };
        assert_eq!(db_path_for(None).unwrap(), main);
        assert_eq!(db_path_for(Some("main.db")).unwrap(), main);
        let demo = db_path_for(Some("demo.db")).unwrap();
        assert!(demo.ends_with(format!("{APP_IDENTIFIER}/demo.db")));
        assert_eq!(demo.parent(), main.parent());
        for name in [
            "",
            "other.db",
            "MAIN.DB",
            "main.db ",
            "../main.db",
            "/etc/passwd",
            "sub/demo.db",
            "demo.db/..",
            "..\\demo.db",
        ] {
            let error = db_path_for(Some(name)).unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidParam, "{name:?}");
        }
    }

    #[test]
    fn mcp_info_points_at_this_executable() {
        let Ok(info) = mcp_info() else {
            return;
        };
        assert_eq!(info.args, vec!["--mcp"]);
        assert_eq!(info.platform, platform());
        assert_eq!(
            info.claude_desktop_config_path.is_none(),
            platform() == McpPlatform::Linux
        );
    }
}
