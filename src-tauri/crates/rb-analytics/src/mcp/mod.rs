//! The MCP server (plan 2.12), started by `Rowing Beacon --mcp`: JSON-RPC
//! on stdin/stdout, no window, no Tauri, no tokio. Also the proposals
//! inbox the server writes and the app reads.
//!
//! - `jsonrpc`: framing and message classification;
//! - `protocol`: the MCP methods of both eras (legacy `initialize`, modern
//!   per-request `_meta`);
//! - `tools`: the five tools, over a `QueryRunner` (the engine);
//! - `inbox`: the proposals folder (`analytics-inbox/<uuid>.json`);
//! - `last_call`: the last `tools/call` received (`mcp-last-call.json`);
//! - `chart_shape`: the Rust mirror of the zod `ChartSpec`;
//! - `stdio`: the transport loop and the Windows standard-handle check.

pub mod chart_shape;
pub mod inbox;
pub mod jsonrpc;
pub mod last_call;
pub mod protocol;
pub mod stdio;
pub mod tools;

use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::error::AnalyticsError;
use crate::ipc::{InboxProposal, McpLastCall};
use crate::paths;

use protocol::{Cancellations, Server};
use tools::{EngineRunner, QueryRunner, ToolEnv, Tools};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct McpOptions {
    /// `--db <path>`: overrides `paths::db_path()` (tests, several installs).
    pub db_path: Option<PathBuf>,
    /// `--inbox <dir>`: overrides `paths::inbox_dir()` (tests, together
    /// with `--db`).
    pub inbox_dir: Option<PathBuf>,
}

impl McpOptions {
    pub fn from_args() -> Self {
        Self::parse(std::env::args_os().skip(1))
    }

    /// Reads `--db <path>`, `--db=<path>`, `--inbox <dir>` and
    /// `--inbox=<dir>`; other arguments (`--mcp`) are ignored.
    pub fn parse(args: impl IntoIterator<Item = OsString>) -> Self {
        let mut options = McpOptions::default();
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            if arg == "--db" {
                options.db_path = args.next().map(PathBuf::from);
            } else if arg == "--inbox" {
                options.inbox_dir = args.next().map(PathBuf::from);
            } else if let Some(path) = arg.to_str().and_then(|a| a.strip_prefix("--db=")) {
                options.db_path = Some(PathBuf::from(path));
            } else if let Some(path) = arg.to_str().and_then(|a| a.strip_prefix("--inbox=")) {
                options.inbox_dir = Some(PathBuf::from(path));
            }
        }
        options
    }

    /// The database and inbox paths: the options, else `paths.rs`.
    pub fn resolve(&self) -> Result<ToolEnv, AnalyticsError> {
        let db_path = match &self.db_path {
            Some(path) => path.clone(),
            None => paths::db_path()?,
        };
        let inbox_dir = match &self.inbox_dir {
            Some(dir) => dir.clone(),
            None => paths::inbox_dir()?,
        };
        Ok(ToolEnv {
            db_path,
            inbox_dir,
            now_override: None,
        })
    }
}

/// One log line on stderr (never stdout, which carries only JSON-RPC).
/// Errors are ignored: stderr may be closed or point nowhere.
pub(crate) fn log(message: &str) {
    let _ = writeln!(std::io::stderr().lock(), "rowing-beacon-mcp: {message}");
}

/// Serves until stdin closes; returns the process exit code (0 after a
/// normal end, 1 when stdout fails or the paths cannot be found, 2 when
/// started without standard handles on Windows).
pub fn run_stdio(opts: McpOptions) -> i32 {
    if !stdio::check_std_handles() {
        return 2;
    }
    let env = match opts.resolve() {
        Ok(env) => env,
        Err(error) => {
            log(&format!(
                "cannot find the Rowing Beacon folders: {}",
                error.message
            ));
            return 1;
        }
    };
    log(&format!(
        "{} {} serving {} (inbox {})",
        protocol::SERVER_NAME,
        protocol::server_version(),
        env.db_path.display(),
        env.inbox_dir.display()
    ));
    let runner: Arc<dyn QueryRunner> = Arc::new(EngineRunner::new());
    match serve_with(
        std::io::BufReader::new(std::io::stdin()),
        std::io::stdout(),
        env,
        runner,
    ) {
        Ok(()) => 0,
        Err(error) => {
            log(&format!("stdout: {error}"));
            1
        }
    }
}

/// Serves `input` → `output` with `env` and `runner` (the stdio session
/// of `run_stdio`, reusable by tests and other transports).
pub fn serve_with(
    input: impl std::io::BufRead + Send + 'static,
    output: impl Write,
    env: ToolEnv,
    runner: Arc<dyn QueryRunner>,
) -> std::io::Result<()> {
    let cancellations = Arc::new(Cancellations::default());
    let server = Server::new(Tools::new(env, runner), Arc::clone(&cancellations));
    stdio::serve(input, output, server, cancellations)
}

/// The proposals waiting in `dir` (`<uuid>.json`), unreadable files
/// included with their `error`. A missing folder is an empty inbox.
pub fn inbox_list(dir: &Path) -> Result<Vec<InboxProposal>, AnalyticsError> {
    inbox::list(dir)
}

/// The last `tools/call` an AI app sent on this computer (None: none
/// yet), read from next to the inbox folder `inbox_dir`.
pub fn last_call(inbox_dir: &Path) -> Option<McpLastCall> {
    last_call::read(inbox_dir)
}

/// Deletes `<dir>/<id>.json` once the app has imported it; `id` must be a
/// UUID.
pub fn inbox_remove(dir: &Path, id: &str) -> Result<(), AnalyticsError> {
    inbox::remove(dir, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn reads_the_db_option() {
        assert_eq!(McpOptions::parse(args(&["--mcp"])).db_path, None);
        assert_eq!(
            McpOptions::parse(args(&["--mcp", "--db", "/tmp/a b.db"])).db_path,
            Some(PathBuf::from("/tmp/a b.db"))
        );
        assert_eq!(
            McpOptions::parse(args(&["--db=/tmp/c.db", "--mcp"])).db_path,
            Some(PathBuf::from("/tmp/c.db"))
        );
        let both = McpOptions::parse(args(&["--mcp", "--inbox", "/x/in", "--db=/x/m.db"]));
        assert_eq!(both.inbox_dir, Some(PathBuf::from("/x/in")));
        assert_eq!(both.db_path, Some(PathBuf::from("/x/m.db")));
        assert_eq!(
            McpOptions::parse(args(&["--inbox=/y"])).inbox_dir,
            Some(PathBuf::from("/y"))
        );
        let env = both.resolve().unwrap();
        assert_eq!(env.db_path, PathBuf::from("/x/m.db"));
        assert_eq!(env.inbox_dir, PathBuf::from("/x/in"));
    }
}
