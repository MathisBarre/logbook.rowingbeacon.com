//! The last `tools/call` this computer's MCP server received, kept in
//! `mcp-last-call.json` next to the inbox folder, so Gestion › Statistiques
//! et IA can show that an AI app (Claude Desktop, Codex…) is connected:
//! `{ "client": "claude-ai" | null, "at": "YYYY-MM-DDTHH:mm" }` (local
//! time). Written atomically (a temporary file of this process, then
//! rename: two AI apps may run a server each) and never in `main.db`; a
//! failure to write is ignored: it must never break a tool call.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::json;

use crate::ipc::McpLastCall;

pub const LAST_CALL_FILE: &str = "mcp-last-call.json";

/// `<parent of the inbox>/mcp-last-call.json`; None for a root inbox.
pub fn last_call_path(inbox_dir: &Path) -> Option<PathBuf> {
    inbox_dir.parent().map(|dir| dir.join(LAST_CALL_FILE))
}

/// "YYYY-MM-DDTHH:mm".
pub(crate) fn is_local_minute(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 16
        && bytes.iter().enumerate().all(|(i, b)| match i {
            4 | 7 => *b == b'-',
            10 => *b == b'T',
            13 => *b == b':',
            _ => b.is_ascii_digit(),
        })
}

/// Records a call; errors are ignored (logged on stderr).
pub fn record(inbox_dir: &Path, client: Option<&str>, at: &str) {
    if !is_local_minute(at) {
        return;
    }
    let Some(path) = last_call_path(inbox_dir) else {
        return;
    };
    if let Err(error) = write_atomically(&path, client, at) {
        super::log(&format!("cannot write {}: {error}", path.display()));
    }
}

fn write_atomically(path: &Path, client: Option<&str>, at: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let text = json!({ "client": client, "at": at }).to_string();
    // One temporary name per process and write: a shared name would let
    // a second server truncate it while the first one renames it.
    static WRITES: AtomicU64 = AtomicU64::new(0);
    let tmp = path.with_extension(format!(
        "json.{}-{}.tmp",
        std::process::id(),
        WRITES.fetch_add(1, Ordering::Relaxed)
    ));
    let written = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(text.as_bytes())?;
        file.write_all(b"\n")?;
        drop(file);
        fs::rename(&tmp, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    written
}

/// The last call, or None when none was recorded (or the file is not
/// readable as such).
pub fn read(inbox_dir: &Path) -> Option<McpLastCall> {
    let text = fs::read_to_string(last_call_path(inbox_dir)?).ok()?;
    let call: McpLastCall = serde_json::from_str(&text).ok()?;
    if !is_local_minute(&call.at) {
        return None;
    }
    let client = call
        .client
        .map(|name| {
            name.chars()
                .filter(|c| !c.is_control())
                .take(100)
                .collect::<String>()
        })
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    Some(McpLastCall {
        client,
        at: call.at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_and_reads_the_last_call() {
        let dir = tempfile::tempdir().unwrap();
        let inbox = dir.path().join("analytics-inbox");
        assert_eq!(read(&inbox), None);
        record(&inbox, Some("claude-ai"), "2026-06-20T09:47");
        assert_eq!(
            read(&inbox),
            Some(McpLastCall {
                client: Some("claude-ai".into()),
                at: "2026-06-20T09:47".into(),
            })
        );
        record(&inbox, None, "2026-06-21T10:00");
        assert_eq!(
            read(&inbox),
            Some(McpLastCall {
                client: None,
                at: "2026-06-21T10:00".into(),
            })
        );
        let names: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![LAST_CALL_FILE.to_string()], "no .tmp left");
        assert!(!inbox.exists(), "the inbox itself is not created");
    }

    #[test]
    fn concurrent_writers_leave_a_whole_file() {
        let dir = tempfile::tempdir().unwrap();
        let inbox = dir.path().join("analytics-inbox");
        let writers: Vec<_> = (0..8)
            .map(|n| {
                let inbox = inbox.clone();
                std::thread::spawn(move || {
                    for _ in 0..50 {
                        record(&inbox, Some(&format!("client-{n}")), "2026-06-20T09:47");
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }
        let last = read(&inbox).expect("a whole file");
        assert!(last.client.unwrap().starts_with("client-"));
        let names: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![LAST_CALL_FILE.to_string()], "no .tmp left");
    }

    #[test]
    fn ignores_bad_times_and_unreadable_files() {
        let dir = tempfile::tempdir().unwrap();
        let inbox = dir.path().join("inbox");
        record(&inbox, Some("x"), "yesterday");
        assert_eq!(read(&inbox), None);
        fs::write(dir.path().join(LAST_CALL_FILE), "not json").unwrap();
        assert_eq!(read(&inbox), None);
        fs::write(
            dir.path().join(LAST_CALL_FILE),
            r#"{"client":" \u0007 ","at":"2026-06-20T09:47"}"#,
        )
        .unwrap();
        assert_eq!(
            read(&inbox),
            Some(McpLastCall {
                client: None,
                at: "2026-06-20T09:47".into(),
            })
        );
        // A read-only or missing parent never panics.
        record(Path::new("/"), Some("x"), "2026-06-20T09:47");
    }
}
