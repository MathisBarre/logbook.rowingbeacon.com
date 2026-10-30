//! Console-subsystem twin of `Rowing Beacon --mcp` (see the WP2 hand-off):
//! the MCP server on stdio, for Windows if the GUI build cannot serve.
fn main() {
    std::process::exit(rb_analytics::mcp::run_stdio(
        rb_analytics::mcp::McpOptions::from_args(),
    ));
}
