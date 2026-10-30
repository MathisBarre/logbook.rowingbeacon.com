//! Analytics of Rowing Beacon (ADR 0008): the read-only SQL engine, the
//! Anthropic proxy, the MCP server and the paths they share.
//!
//! The crate has no Tauri dependency, so `cargo test -p rb-analytics`
//! builds without webkit. The app glue lives in
//! `src-tauri/src/analytics_commands.rs`.
//!
//! Ownership: `engine` WP1, `ai` and `mcp` WP2; `error`, `ipc`, `paths`
//! and `assets` are the WP0 contract; `perf` holds the performance
//! profiles shared by the engine, the app and the MCP server.

pub mod ai;
pub mod assets;
pub mod engine;
pub mod error;
pub mod ipc;
pub mod mcp;
pub mod paths;
pub mod perf;

pub use error::{AnalyticsError, ErrorCode};
