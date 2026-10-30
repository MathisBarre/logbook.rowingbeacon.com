import { describe, expect, it } from "vitest";
import fixtures from "../engine/ipc-fixtures.json";
import type { McpInfo } from "../engine/ipc";
import {
  claudeCodeCommand,
  claudeDesktopConfig,
  claudeDesktopConfigPath,
  codexConfigPath,
  codexConfigToml,
  cursorConfig,
  cursorConfigPath,
  isTemporaryMacosPath,
  shellQuote,
  stdioCommand,
  vscodeConfig,
} from "./mcpSnippets";

const [windows, linux] = fixtures.McpInfo as McpInfo[];

interface DesktopConfig {
  mcpServers: Record<string, { command: string; args: string[] }>;
}
const server = (text: string) =>
  (JSON.parse(text) as DesktopConfig).mcpServers["rowing-beacon"];
const macos: McpInfo = {
  exePath: "/Applications/Rowing Beacon.app/Contents/MacOS/Rowing Beacon",
  args: ["--mcp"],
  dbPath:
    "/Users/club/Library/Application Support/com.rowing-beacon-tauri-app.app/main.db",
  inboxDir:
    "/Users/club/Library/Application Support/com.rowing-beacon-tauri-app.app/analytics-inbox",
  claudeDesktopConfigPath:
    "/Users/club/Library/Application Support/Claude/claude_desktop_config.json",
  platform: "macos",
  isAppImage: false,
};

describe("claudeDesktopConfig", () => {
  it("is valid JSON with the Windows path's backslashes and spaces", () => {
    const text = claudeDesktopConfig(windows);
    expect(text).toContain(
      '"command": "C:\\\\Program Files\\\\Rowing Beacon\\\\Rowing Beacon.exe"'
    );
    expect(JSON.parse(text)).toEqual({
      mcpServers: {
        "rowing-beacon": {
          command: "C:\\Program Files\\Rowing Beacon\\Rowing Beacon.exe",
          args: ["--mcp"],
        },
      },
    });
  });

  it("keeps a macOS path as is", () => {
    expect(server(claudeDesktopConfig(macos))).toEqual({
      command: macos.exePath,
      args: ["--mcp"],
    });
  });

  it("defaults the arguments to --mcp", () => {
    expect(
      server(claudeDesktopConfig({ exePath: "/x", args: [] })).args
    ).toEqual(["--mcp"]);
  });
});

describe("claudeCodeCommand", () => {
  it("quotes the Windows path", () => {
    expect(claudeCodeCommand(windows)).toBe(
      'claude mcp add --scope user rowing-beacon -- "C:\\Program Files\\Rowing Beacon\\Rowing Beacon.exe" --mcp'
    );
  });

  it("quotes macOS and Linux paths", () => {
    expect(claudeCodeCommand(macos)).toBe(
      'claude mcp add --scope user rowing-beacon -- "/Applications/Rowing Beacon.app/Contents/MacOS/Rowing Beacon" --mcp'
    );
    expect(claudeCodeCommand(linux)).toBe(
      'claude mcp add --scope user rowing-beacon -- "/home/club/Applications/rowing-beacon.AppImage" --mcp'
    );
  });

  it("escapes POSIX shell characters inside the quotes", () => {
    expect(shellQuote('/opt/a "b" $HOME `x` \\y', "linux")).toBe(
      '"/opt/a \\"b\\" \\$HOME \\`x\\` \\\\y"'
    );
    expect(shellQuote('C:\\a"b', "windows")).toBe('"C:\\ab"');
  });

  it("passes extra arguments, quoting the unusual ones", () => {
    expect(
      claudeCodeCommand({
        exePath: "/usr/bin/rb",
        args: ["--mcp", "--db", "/home/club/my db/main.db"],
        platform: "linux",
      })
    ).toBe(
      'claude mcp add --scope user rowing-beacon -- "/usr/bin/rb" --mcp --db "/home/club/my db/main.db"'
    );
  });
});

describe("claudeDesktopConfigPath", () => {
  it("is null on Linux, the Rust path elsewhere, a default otherwise", () => {
    expect(claudeDesktopConfigPath(linux)).toBeNull();
    expect(claudeDesktopConfigPath(windows)).toBe(
      "C:\\Users\\Club\\AppData\\Roaming\\Claude\\claude_desktop_config.json"
    );
    expect(
      claudeDesktopConfigPath({
        platform: "macos",
        claudeDesktopConfigPath: null,
      })
    ).toBe("~/Library/Application Support/Claude/claude_desktop_config.json");
    expect(
      claudeDesktopConfigPath({
        platform: "windows",
        claudeDesktopConfigPath: null,
      })
    ).toBe("%APPDATA%\\Claude\\claude_desktop_config.json");
  });
});

describe("isTemporaryMacosPath", () => {
  it("flags a disk image or a translocated app, only on macOS", () => {
    expect(isTemporaryMacosPath(macos)).toBe(false);
    expect(
      isTemporaryMacosPath({
        ...macos,
        exePath:
          "/private/var/folders/x1/T/AppTranslocation/0A1B/d/Rowing Beacon.app/Contents/MacOS/Rowing Beacon",
      })
    ).toBe(true);
    expect(
      isTemporaryMacosPath({
        ...macos,
        exePath:
          "/Volumes/Rowing Beacon/Rowing Beacon.app/Contents/MacOS/Rowing Beacon",
      })
    ).toBe(true);
    expect(isTemporaryMacosPath(windows)).toBe(false);
    expect(isTemporaryMacosPath(linux)).toBe(false);
  });
});

describe("other MCP clients", () => {
  it("writes Codex's TOML with JSON-escaped strings", () => {
    const text = codexConfigToml(windows);
    expect(text).toBe(
      [
        "[mcp_servers.rowing-beacon]",
        'command = "C:\\\\Program Files\\\\Rowing Beacon\\\\Rowing Beacon.exe"',
        'args = ["--mcp"]',
      ].join("\n")
    );
    expect(codexConfigToml({ exePath: 'a"b', args: [] })).toContain(
      'command = "a\\"b"'
    );
    expect(codexConfigPath("windows")).toBe(
      "%USERPROFILE%\\.codex\\config.toml"
    );
    expect(codexConfigPath("linux")).toBe("~/.codex/config.toml");
  });

  it("writes Cursor's and VS Code's stdio blocks", () => {
    expect(JSON.parse(cursorConfig(macos))).toEqual({
      mcpServers: {
        "rowing-beacon": {
          type: "stdio",
          command: macos.exePath,
          args: ["--mcp"],
        },
      },
    });
    expect(cursorConfigPath("macos")).toBe("~/.cursor/mcp.json");
    expect(cursorConfigPath("windows")).toBe(
      "%USERPROFILE%\\.cursor\\mcp.json"
    );
    expect(JSON.parse(vscodeConfig(linux))).toEqual({
      servers: {
        "rowing-beacon": {
          type: "stdio",
          command: linux.exePath,
          args: linux.args,
        },
      },
    });
  });

  it("quotes the command line for any other client", () => {
    expect(stdioCommand(macos)).toBe(
      '"/Applications/Rowing Beacon.app/Contents/MacOS/Rowing Beacon" --mcp'
    );
    expect(claudeCodeCommand(macos)).toBe(
      `claude mcp add --scope user rowing-beacon -- ${stdioCommand(macos)}`
    );
  });
});
