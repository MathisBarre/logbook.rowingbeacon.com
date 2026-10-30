/**
 * The display name of the MCP client that proposed a chart, from its
 * `clientInfo.name` (ADR 0008 "AI providers"). Known clients get their
 * product name; any other name is shown as sent, cleaned and cut; null
 * when the client gave none (the caller says "Assistant IA (MCP)").
 */

const KNOWN: readonly [RegExp, string][] = [
  [/^claude-ai$|^claude[ -]desktop$/i, "Claude Desktop"],
  [/^claude-code$/i, "Claude Code"],
  [/codex/i, "Codex"],
  [/chatgpt/i, "ChatGPT"],
  // Cursor's name contains "vscode": it must come first.
  [/cursor/i, "Cursor"],
  [/^visual studio code|^vscode|^vs code/i, "VS Code"],
];

const MAX_NAME_LENGTH = 40;

export const mcpClientName = (
  client: string | null | undefined
): string | null => {
  // eslint-disable-next-line no-control-regex
  const name = (client ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (name === "") return null;
  const known = KNOWN.find(([pattern]) => pattern.test(name));
  if (known) return known[1];
  return name.length > MAX_NAME_LENGTH
    ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…`
    : name;
};
