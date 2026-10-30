/**
 * The MCP client that proposed a chart (`clientInfo.name`, e.g.
 * "claude-ai", "codex", "cursor"), so the Explorer names it: any local
 * MCP client can propose charts (ADR 0008 "AI providers"). Null for the
 * other origins and for proposals imported before this column.
 */
export default /*sql*/ `
ALTER TABLE analytics_query ADD COLUMN client TEXT;
`;
