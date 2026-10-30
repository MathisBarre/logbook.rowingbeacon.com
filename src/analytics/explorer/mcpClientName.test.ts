import { describe, expect, it } from "vitest";
import { mcpClientName } from "./mcpClientName";

describe("mcpClientName", () => {
  it("names the known MCP clients", () => {
    expect(mcpClientName("claude-ai")).toBe("Claude Desktop");
    expect(mcpClientName("claude-code")).toBe("Claude Code");
    expect(mcpClientName("codex-mcp-client")).toBe("Codex");
    expect(mcpClientName("cursor-vscode")).toBe("Cursor");
    expect(mcpClientName("Visual Studio Code")).toBe("VS Code");
  });

  it("shows other names as sent, cleaned and cut", () => {
    expect(mcpClientName(" my-client\n")).toBe("my-client");
    expect(mcpClientName("x".repeat(60))).toBe(`${"x".repeat(39)}…`);
    expect(mcpClientName("")).toBeNull();
    expect(mcpClientName(null)).toBeNull();
    expect(mcpClientName(undefined)).toBeNull();
  });
});
