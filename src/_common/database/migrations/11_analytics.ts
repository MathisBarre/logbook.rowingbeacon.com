/**
 * Analytics (ADR 0008): queries saved from the editor, the AI assistant,
 * a customised report or a Claude proposal, and the items pinned to the
 * dashboard. Analytics views are TEMP views of the read-only engine and
 * are never stored here.
 */
export default /*sql*/ `
---
CREATE TABLE IF NOT EXISTS analytics_query (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  sql TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '[]',
  chart TEXT,
  origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'ai', 'mcp', 'report')),
  status TEXT NOT NULL DEFAULT 'saved' CHECK (status IN ('saved', 'proposed')),
  based_on_report_id TEXT,
  spec_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS analytics_dashboard_item (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL DEFAULT 'main',
  position INTEGER NOT NULL DEFAULT 0,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('report', 'query')),
  report_id TEXT,
  query_id TEXT REFERENCES analytics_query (id) ON DELETE CASCADE,
  size TEXT NOT NULL DEFAULT 'half' CHECK (size IN ('third', 'half', 'full')),
  param_values TEXT NOT NULL DEFAULT '{}',
  chart_override TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((source_kind = 'report' AND report_id IS NOT NULL AND query_id IS NULL)
      OR (source_kind = 'query' AND query_id IS NOT NULL AND report_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_analytics_dashboard_item_position
  ON analytics_dashboard_item (dashboard_id, position);
---
`;
