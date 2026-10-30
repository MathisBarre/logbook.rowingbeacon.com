import type { McpInfo, McpPlatform } from "../engine/ipc";

/**
 * Ready-to-paste MCP configuration for the local (stdio) MCP clients
 * whose format was checked (plan 2.12, "Config snippets"; ADR 0008 "AI
 * providers"), built from `analytics_mcp_info`:
 *
 * - Claude Desktop: `claude_desktop_config.json`, `mcpServers`;
 * - Claude Code: `claude mcp add --scope user`;
 * - Codex (shared by the ChatGPT desktop app, Codex CLI and the IDE
 *   extension): `~/.codex/config.toml`, `[mcp_servers.<name>]`;
 * - Cursor: `~/.cursor/mcp.json`, `mcpServers` with `type: "stdio"`;
 * - VS Code (Copilot agent mode): the user `mcp.json` ("MCP: Open User
 *   Configuration"), `servers` with `type: "stdio"`.
 */

const MCP_SERVER_NAME = "rowing-beacon";

const argsOf = (info: Pick<McpInfo, "args">) =>
  info.args.length > 0 ? info.args : ["--mcp"];

/**
 * Claude Desktop's `claude_desktop_config.json` block. JSON.stringify
 * escapes Windows backslashes and quotes, so the block is always valid.
 */
export const claudeDesktopConfig = (
  info: Pick<McpInfo, "exePath" | "args">
): string =>
  JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: { command: info.exePath, args: argsOf(info) },
      },
    },
    null,
    2
  );

/** Quotes one argument for the platform's usual shell. */
export const shellQuote = (value: string, platform: McpPlatform): string => {
  if (platform === "windows") {
    // PowerShell and cmd: Windows paths cannot contain double quotes.
    return `"${value.replace(/"/g, "")}"`;
  }
  // POSIX shells: inside double quotes, \ " $ ` keep a special meaning.
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
};

/**
 * `claude mcp add` command. `--scope user` makes the server available in
 * every folder (the default scope only covers the current project).
 */
export const claudeCodeCommand = (
  info: Pick<McpInfo, "exePath" | "args" | "platform">
): string =>
  `claude mcp add --scope user ${MCP_SERVER_NAME} -- ${stdioCommand(info)}`;

/** Where Claude Desktop keeps its configuration; null on Linux. */
export const claudeDesktopConfigPath = (
  info: Pick<McpInfo, "claudeDesktopConfigPath" | "platform">
): string | null => {
  if (info.platform === "linux") {
    return null;
  }
  if (info.claudeDesktopConfigPath) {
    return info.claudeDesktopConfigPath;
  }
  return info.platform === "windows"
    ? "%APPDATA%\\Claude\\claude_desktop_config.json"
    : "~/Library/Application Support/Claude/claude_desktop_config.json";
};

/**
 * macOS runs an app opened from a disk image, or straight from Downloads
 * before it was moved, from a temporary path (a mounted volume or "App
 * Translocation"). That path is gone at the next launch, so a copied
 * configuration would stop working: the settings ask to install first.
 */
export const isTemporaryMacosPath = (
  info: Pick<McpInfo, "exePath" | "platform">
): boolean =>
  info.platform === "macos" &&
  (info.exePath.includes("/AppTranslocation/") ||
    info.exePath.startsWith("/Volumes/"));

/** The quoted command line, for any other MCP client (stdio). */
export const stdioCommand = (
  info: Pick<McpInfo, "exePath" | "args" | "platform">
): string =>
  [info.exePath, ...argsOf(info)]
    .map((part, index) =>
      index === 0 || /[^A-Za-z0-9_\-=./:]/.test(part)
        ? shellQuote(part, info.platform)
        : part
    )
    .join(" ");

/**
 * Codex's `config.toml` section. A JSON string is also a TOML basic
 * string (same quotes and escapes, `\uXXXX` included), so Windows
 * backslashes and quotes stay valid.
 */
export const codexConfigToml = (
  info: Pick<McpInfo, "exePath" | "args">
): string =>
  [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `command = ${JSON.stringify(info.exePath)}`,
    `args = [${argsOf(info)
      .map((arg) => JSON.stringify(arg))
      .join(", ")}]`,
  ].join("\n");

/** Where Codex keeps its configuration (the user's home folder). */
export const codexConfigPath = (platform: McpPlatform): string =>
  platform === "windows"
    ? "%USERPROFILE%\\.codex\\config.toml"
    : "~/.codex/config.toml";

const stdioServer = (info: Pick<McpInfo, "exePath" | "args">) => ({
  type: "stdio",
  command: info.exePath,
  args: argsOf(info),
});

/** Cursor's `mcp.json` block (global configuration). */
export const cursorConfig = (info: Pick<McpInfo, "exePath" | "args">) =>
  JSON.stringify(
    { mcpServers: { [MCP_SERVER_NAME]: stdioServer(info) } },
    null,
    2
  );

/** Where Cursor keeps its global MCP configuration. */
export const cursorConfigPath = (platform: McpPlatform): string =>
  platform === "windows"
    ? "%USERPROFILE%\\.cursor\\mcp.json"
    : "~/.cursor/mcp.json";

/** VS Code's user `mcp.json` block (`servers`, not `mcpServers`). */
export const vscodeConfig = (info: Pick<McpInfo, "exePath" | "args">) =>
  JSON.stringify(
    { servers: { [MCP_SERVER_NAME]: stdioServer(info) } },
    null,
    2
  );
