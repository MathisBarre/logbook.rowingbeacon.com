// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `Rowing Beacon --mcp`: the MCP server for Claude (ADR 0008), on
    // stdin/stdout, without a window. `args_os`: `args` panics on an
    // argument that is not UTF-8 (a path a launcher passes on Linux).
    if std::env::args_os().any(|arg| arg == "--mcp") {
        std::process::exit(rb_analytics::mcp::run_stdio(
            rb_analytics::mcp::McpOptions::from_args(),
        ));
    }
    rowing_beacon_tauri_app::run();
}
