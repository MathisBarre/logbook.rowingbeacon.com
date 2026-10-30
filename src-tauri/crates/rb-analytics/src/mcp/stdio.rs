//! The stdio transport: newline-delimited JSON-RPC on stdin/stdout, logs on
//! stderr.
//!
//! A reader thread reads stdin line by line (bounded) and hands each
//! message to the main thread, which handles requests one after the other
//! (plan 2.12). The reader looks at every `notifications/cancelled` as it
//! arrives, so a query that is running can be stopped at once; the answer
//! of a cancelled request is never written. When stdin closes, the
//! messages already read are still answered, then the server exits; if
//! that takes more than `EOF_GRACE` (a 20 s report while Claude Desktop
//! restarts the server), the running query is cancelled and the messages
//! still waiting are dropped: nobody reads the answers any more.
//!
//! Windows: release builds of the app use the GUI subsystem (no console).
//! Claude Desktop and Claude Code start servers with redirected pipes
//! (`STARTF_USESTDHANDLES`), which a GUI process inherits like a console
//! one, so stdio works. Started by hand from a terminal, a GUI process has
//! no standard handles at all: Rust then reads EOF and writes to nothing.
//! `check_std_handles` detects that case and explains it on the terminal
//! instead of exiting silently (see the WP2 hand-off).

use std::io::{self, BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde_json::Value;

use super::jsonrpc::{error_response, INVALID_REQUEST, PARSE_ERROR};
use super::protocol::{cancelled_request_id, engine_request_id, Cancellations, Server};
use super::tools::QueryRunner;

/// Longest accepted line (a `propose_chart` call is a few kB).
pub const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
/// How long the work read before stdin closed may still run. Long enough
/// for `echo … | rowing-beacon --mcp` with a quick query; short enough
/// that a client restarting the server does not wait for a heavy report.
pub const EOF_GRACE: Duration = Duration::from_secs(2);

/// What the reader thread passes on.
enum Input {
    Line(String),
    /// A line over `MAX_LINE_BYTES` (skipped up to its newline).
    TooLong,
    /// Not UTF-8.
    NotUtf8,
}

/// Reads one line of at most `max` bytes (newline excluded) into `buf`.
/// `Ok(None)` at end of input. A longer line is consumed to its end and
/// reported with `Ok(Some(false))`.
fn read_bounded_line(
    reader: &mut impl BufRead,
    buf: &mut Vec<u8>,
    max: usize,
) -> io::Result<Option<bool>> {
    buf.clear();
    let mut too_long = false;
    let mut read_any = false;
    loop {
        let available = match reader.fill_buf() {
            Ok(available) => available,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        if available.is_empty() {
            return Ok(if read_any { Some(!too_long) } else { None });
        }
        read_any = true;
        let (chunk, found_newline) = match available.iter().position(|b| *b == b'\n') {
            Some(index) => (&available[..index], true),
            None => (available, false),
        };
        if !too_long {
            if buf.len() + chunk.len() > max {
                too_long = true;
                buf.clear();
            } else {
                buf.extend_from_slice(chunk);
            }
        }
        let used = chunk.len() + usize::from(found_newline);
        reader.consume(used);
        if found_newline {
            return Ok(Some(!too_long));
        }
    }
}

/// What the reader thread shares with the main thread at end of input.
struct Shutdown {
    /// Set once `EOF_GRACE` has passed after end of input.
    closing: Arc<AtomicBool>,
    /// Disconnected when the main thread has answered everything.
    done: mpsc::Receiver<()>,
}

fn reader_thread(
    mut input: impl BufRead,
    sender: mpsc::Sender<Input>,
    cancellations: Arc<Cancellations>,
    runner: Arc<dyn QueryRunner>,
    shutdown: Shutdown,
) {
    let mut buf = Vec::new();
    loop {
        let item = match read_bounded_line(&mut input, &mut buf, MAX_LINE_BYTES) {
            Ok(None) => break,
            Ok(Some(false)) => Input::TooLong,
            Ok(Some(true)) => match String::from_utf8(std::mem::take(&mut buf)) {
                Ok(line) => {
                    look_for_cancellation(&line, &cancellations, runner.as_ref());
                    Input::Line(line)
                }
                Err(_) => Input::NotUtf8,
            },
            Err(error) => {
                super::log(&format!("stdin: {error}"));
                break;
            }
        };
        if sender.send(item).is_err() {
            break;
        }
    }
    // The main thread answers what it has, then ends its loop.
    drop(sender);
    if let Err(mpsc::RecvTimeoutError::Timeout) = shutdown.done.recv_timeout(EOF_GRACE) {
        super::log("stdin closed: stopping the running query");
        shutdown.closing.store(true, Ordering::Relaxed);
        runner.cancel_all();
    }
}

/// Records the cancellations of a line (a message or a batch) and stops
/// the matching engine query.
fn look_for_cancellation(line: &str, cancellations: &Cancellations, runner: &dyn QueryRunner) {
    if !line.contains("notifications/cancelled") {
        return;
    }
    let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
        return;
    };
    let messages = match &value {
        Value::Array(items) => items.iter().collect::<Vec<_>>(),
        other => vec![other],
    };
    for message in messages {
        if let Some(id) = cancelled_request_id(message) {
            cancellations.record(id);
            runner.cancel(&engine_request_id(id));
        }
    }
}

/// Serves `input` → `output` until the input ends or the output fails.
pub fn serve(
    input: impl BufRead + Send + 'static,
    mut output: impl Write,
    mut server: Server,
    cancellations: Arc<Cancellations>,
) -> io::Result<()> {
    let (sender, receiver) = mpsc::channel();
    let (done, done_receiver) = mpsc::channel::<()>();
    let closing = Arc::new(AtomicBool::new(false));
    let runner = Arc::clone(&server.tools().runner);
    let reader = {
        let cancellations = Arc::clone(&cancellations);
        let shutdown = Shutdown {
            closing: Arc::clone(&closing),
            done: done_receiver,
        };
        thread::Builder::new()
            .name("mcp-stdin".into())
            .spawn(move || reader_thread(input, sender, cancellations, runner, shutdown))?
    };
    for item in receiver {
        if closing.load(Ordering::Relaxed) {
            break;
        }
        let replies = match item {
            Input::Line(line) => server.handle_line(&line),
            Input::TooLong => vec![error_response(
                Value::Null,
                INVALID_REQUEST,
                format!("Message longer than {MAX_LINE_BYTES} bytes"),
                None,
            )],
            Input::NotUtf8 => vec![error_response(
                Value::Null,
                PARSE_ERROR,
                "Parse error: not UTF-8",
                None,
            )],
        };
        for reply in replies {
            write_message(&mut output, &reply)?;
        }
    }
    // The reader has stopped reading (the channel closes only then); it
    // stops waiting for us now.
    drop(done);
    let _ = reader.join();
    Ok(())
}

/// One message, one line, flushed at once.
pub fn write_message(output: &mut impl Write, message: &Value) -> io::Result<()> {
    let mut line = serde_json::to_vec(message).map_err(io::Error::other)?;
    line.push(b'\n');
    output.write_all(&line)?;
    output.flush()
}

/// Shown on the terminal when the server is started without pipes.
pub const NO_PIPES_MESSAGE: &str =
    "Rowing Beacon --mcp is an MCP server: an AI assistant (Claude, Codex, Cursor, VS Code...) \
starts it and talks to it through pipes, so there is nothing to see here.\r\n\
To connect it, open Rowing Beacon > Gestion > Statistiques et IA and copy the configuration.\r\n\
To try it in a terminal, pipe JSON-RPC lines into it, for example:\r\n\
  echo {\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"} | \"Rowing Beacon.exe\" --mcp | more\r\n";

/// Whether stdin and stdout are usable. Always true outside Windows (a
/// closed descriptor reads EOF and the server exits normally).
#[cfg(not(windows))]
pub fn check_std_handles() -> bool {
    true
}

/// Windows: false when the process has no stdin or stdout (a GUI-subsystem
/// build started from a terminal or a shortcut); the reason is then
/// written to the parent console, if there is one.
#[cfg(windows)]
pub fn check_std_handles() -> bool {
    if win::usable(win::STD_INPUT_HANDLE) && win::usable(win::STD_OUTPUT_HANDLE) {
        return true;
    }
    win::tell_parent_console(NO_PIPES_MESSAGE);
    false
}

#[cfg(windows)]
mod win {
    //! The three kernel32 calls needed, declared here to avoid a
    //! dependency (`windows-sys` is not a dependency of this crate).

    use std::ffi::c_void;
    use std::io::Write;

    type Handle = *mut c_void;

    pub const STD_INPUT_HANDLE: u32 = -10i32 as u32;
    pub const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;
    const ATTACH_PARENT_PROCESS: u32 = -1i32 as u32;
    const FILE_TYPE_UNKNOWN: u32 = 0;
    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(std_handle: u32) -> Handle;
        fn GetFileType(file: Handle) -> u32;
        fn AttachConsole(process_id: u32) -> i32;
    }

    /// A pipe, a file or a console: anything but "none".
    pub fn usable(which: u32) -> bool {
        // SAFETY: plain Win32 calls on a handle owned by the process; the
        // handle is not closed here.
        unsafe {
            let handle = GetStdHandle(which);
            !handle.is_null()
                && handle != INVALID_HANDLE_VALUE
                && GetFileType(handle) != FILE_TYPE_UNKNOWN
        }
    }

    /// Writes `message` to the console of the parent (cmd, PowerShell,
    /// Windows Terminal), if any. ASCII only, so the code page does not
    /// matter.
    pub fn tell_parent_console(message: &str) {
        // SAFETY: AttachConsole has no memory-safety preconditions; it
        // fails harmlessly when there is no parent console or one is
        // already attached.
        let attached = unsafe { AttachConsole(ATTACH_PARENT_PROCESS) } != 0;
        if !attached {
            return;
        }
        if let Ok(mut console) = std::fs::OpenOptions::new().write(true).open("CONOUT$") {
            let _ = console.write_all(b"\r\n");
            let _ = console.write_all(message.as_bytes());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn lines(input: &[u8], max: usize) -> Vec<Result<String, &'static str>> {
        let mut reader = io::BufReader::with_capacity(4, Cursor::new(input.to_vec()));
        let mut buf = Vec::new();
        let mut out = Vec::new();
        while let Some(ok) = read_bounded_line(&mut reader, &mut buf, max).unwrap() {
            out.push(if ok {
                Ok(String::from_utf8(buf.clone()).unwrap())
            } else {
                Err("too long")
            });
        }
        out
    }

    #[test]
    fn reads_bounded_lines() {
        assert_eq!(
            lines(b"ab\r\ncdefghij\nk", 5),
            vec![Ok("ab\r".to_string()), Err("too long"), Ok("k".to_string())]
        );
        assert_eq!(lines(b"", 5), Vec::<Result<String, &str>>::new());
        assert_eq!(
            lines(b"\n\n", 5),
            vec![Ok(String::new()), Ok(String::new())]
        );
        assert_eq!(lines(b"abcde\n", 5), vec![Ok("abcde".to_string())]);
    }

    #[test]
    fn the_terminal_message_is_ascii() {
        assert!(NO_PIPES_MESSAGE.is_ascii());
        assert!(check_std_handles() || cfg!(windows));
    }
}
