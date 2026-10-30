//! Files shared with the TypeScript side, embedded at build time:
//! the views (`views.sql`), the dictionary (`dictionary.json`), the
//! prebuilt reports (`reports.sql`, `catalog.json`). The engine, the MCP
//! server and the app read the very same text.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const VIEWS_SQL: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../src/analytics/schema/views.sql"
));
pub const DICTIONARY_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../src/analytics/schema/dictionary.json"
));
pub const REPORTS_SQL: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../src/analytics/reports/reports.sql"
));
pub const CATALOG_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../src/analytics/reports/catalog.json"
));

pub const VIEW_MARKER: &str = "@view";
pub const REPORT_MARKER: &str = "@report";

/// One block of a block file (same rules as `parseBlocks` in
/// `src/analytics/schema/views.ts`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SqlBlock {
    pub name: String,
    /// Tables the block needs; always empty for reports.
    pub requires: Vec<String>,
    /// The statement, trimmed, trailing `;` kept.
    pub sql: String,
}

/// Parses `-- @view <name> requires=<t1>,<t2>` / `-- @report <id>` lines
/// (`^-- (@view|@report) ([A-Za-z0-9_-]+)(?: requires=(\S*))?\s*$`).
fn parse_marker_line(line: &str) -> Option<(&str, &str, Vec<String>)> {
    let rest = line.strip_prefix("-- ")?;
    let (marker, rest) = match rest.strip_prefix(VIEW_MARKER) {
        Some(rest) => (VIEW_MARKER, rest),
        None => (REPORT_MARKER, rest.strip_prefix(REPORT_MARKER)?),
    };
    let rest = rest.strip_prefix(' ')?;
    let name_len = rest
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
        .unwrap_or(rest.len());
    if name_len == 0 {
        return None;
    }
    let (name, mut rest) = rest.split_at(name_len);
    let mut requires = Vec::new();
    if let Some(after) = rest.strip_prefix(" requires=") {
        let value_len = after.find(char::is_whitespace).unwrap_or(after.len());
        let (value, tail) = after.split_at(value_len);
        requires = value
            .split(',')
            .map(str::trim)
            .filter(|table| !table.is_empty())
            .map(String::from)
            .collect();
        rest = tail;
    }
    if !rest.trim().is_empty() {
        return None;
    }
    Some((marker, name, requires))
}

/// Splits a block file. Lines before the first marker are a header.
pub fn parse_blocks(text: &str, marker: &str) -> Vec<SqlBlock> {
    let mut blocks = Vec::new();
    let mut current: Option<(String, Vec<String>, Vec<&str>)> = None;
    let flush = |current: Option<(String, Vec<String>, Vec<&str>)>, blocks: &mut Vec<SqlBlock>| {
        if let Some((name, requires, lines)) = current {
            blocks.push(SqlBlock {
                name,
                requires,
                sql: lines.join("\n").trim().to_string(),
            });
        }
    };
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if let Some((found, name, requires)) = parse_marker_line(line) {
            if found == marker {
                flush(current.take(), &mut blocks);
                current = Some((name.to_string(), requires, Vec::new()));
                continue;
            }
        }
        if let Some((_, _, lines)) = current.as_mut() {
            lines.push(line);
        }
    }
    flush(current, &mut blocks);
    blocks
}

pub fn view_blocks() -> Vec<SqlBlock> {
    parse_blocks(VIEWS_SQL, VIEW_MARKER)
}

pub fn report_blocks() -> Vec<SqlBlock> {
    parse_blocks(REPORTS_SQL, REPORT_MARKER)
}

// ---------------------------------------------------------------- dictionary

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectKind {
    View,
    Table,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectLevel {
    Simple,
    Advanced,
}

/// Privacy class of a column (plan 2.4).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColumnClass {
    #[default]
    Public,
    /// Names, birth data: NULL in pseudonymised mode.
    Personal,
    /// E-mail, phone, address: always NULL.
    Contact,
    /// Comments: NULL in pseudonymised mode.
    FreeText,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DictionaryColumn {
    pub name: String,
    /// text, integer, real, boolean.
    #[serde(rename = "type")]
    pub column_type: String,
    pub semantic: String,
    #[serde(default)]
    pub class: ColumnClass,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codes: Option<Vec<String>>,
    /// English, read by the AI and the MCP clients.
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DictionaryObject {
    pub name: String,
    pub kind: ObjectKind,
    pub level: ObjectLevel,
    pub requires: Vec<String>,
    pub description: String,
    pub columns: Vec<DictionaryColumn>,
}

impl DictionaryObject {
    pub fn column(&self, name: &str) -> Option<&DictionaryColumn> {
        self.columns.iter().find(|column| column.name == name)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Dictionary {
    pub version: u32,
    pub objects: Vec<DictionaryObject>,
}

impl Dictionary {
    pub fn load() -> Dictionary {
        serde_json::from_str(DICTIONARY_JSON).expect("dictionary.json is valid (tested)")
    }

    pub fn object(&self, name: &str) -> Option<&DictionaryObject> {
        self.objects.iter().find(|object| object.name == name)
    }

    pub fn tables(&self) -> impl Iterator<Item = &DictionaryObject> {
        self.objects
            .iter()
            .filter(|object| object.kind == ObjectKind::Table)
    }

    pub fn views(&self) -> impl Iterator<Item = &DictionaryObject> {
        self.objects
            .iter()
            .filter(|object| object.kind == ObjectKind::View)
    }
}

// ------------------------------------------------------------------ catalog

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogRequires {
    pub tables: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modules: Option<Vec<String>>,
}

/// One entry of `catalog.json` (plan 2.8). `params` and `chart` are kept
/// as JSON: the zod schemas of `chartSpec.ts` are the reference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogEntry {
    pub id: String,
    pub category: String,
    /// public, nominative, admin.
    pub visibility: String,
    /// light, medium, heavy.
    pub cost: String,
    pub requires: CatalogRequires,
    pub params: Value,
    pub chart: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coverage: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<Vec<String>>,
    /// English, for MCP clients.
    pub mcp_description: String,
}

pub fn catalog() -> Vec<CatalogEntry> {
    serde_json::from_str(CATALOG_JSON).expect("catalog.json is valid (tested)")
}

/// The SQL of a prebuilt report.
pub fn report_sql(id: &str) -> Option<String> {
    report_blocks()
        .into_iter()
        .find(|block| block.name == id)
        .map(|block| block.sql)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn parses_view_blocks() {
        let blocks = view_blocks();
        assert!(blocks.len() >= 11);
        let settings = &blocks[0];
        assert_eq!(settings.name, "v_settings");
        assert!(settings.requires.is_empty());
        assert!(settings.sql.starts_with("CREATE TEMP VIEW v_settings AS"));
        assert!(settings.sql.ends_with(';'));
        let damages = blocks.iter().find(|b| b.name == "v_damages").unwrap();
        assert_eq!(damages.requires, vec!["boat_damage", "boat"]);
        for block in &blocks {
            assert!(
                block
                    .sql
                    .starts_with(&format!("CREATE TEMP VIEW {} AS", block.name)),
                "{}",
                block.name
            );
        }
    }

    #[test]
    fn parses_marker_lines_like_typescript() {
        let text = "-- header\r\n-- @view a requires=x, \nSELECT 1;\n-- @report r\nSELECT 2;\n-- @view b\t\n  SELECT 3;  \n-- @view bad name\nSELECT 4;";
        let views = parse_blocks(text, VIEW_MARKER);
        assert_eq!(
            views,
            vec![
                SqlBlock {
                    name: "a".into(),
                    requires: vec!["x".into()],
                    sql: "SELECT 1;\n-- @report r\nSELECT 2;".into()
                },
                SqlBlock {
                    name: "b".into(),
                    requires: vec![],
                    sql: "SELECT 3;  \n-- @view bad name\nSELECT 4;".into()
                },
            ]
        );
        let reports = parse_blocks(text, REPORT_MARKER);
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].name, "r");
        assert!(reports[0].sql.starts_with("SELECT 2;\n-- @view b"));
    }

    #[test]
    fn every_catalog_entry_has_sql() {
        let ids: HashSet<String> = report_blocks().into_iter().map(|b| b.name).collect();
        let entries = catalog();
        assert!(!entries.is_empty());
        for entry in &entries {
            assert!(ids.contains(&entry.id), "{} has no SQL block", entry.id);
            assert!(report_sql(&entry.id).unwrap().ends_with(';'));
        }
    }

    #[test]
    fn dictionary_lists_every_view() {
        let dictionary = Dictionary::load();
        assert_eq!(dictionary.version, 1);
        let views: HashSet<&str> = dictionary.views().map(|o| o.name.as_str()).collect();
        for block in view_blocks() {
            assert!(
                views.contains(block.name.as_str()),
                "{} missing from dictionary",
                block.name
            );
        }
        assert!(dictionary.tables().count() > 0);
        let rower = dictionary.object("rower").unwrap();
        assert!(rower
            .columns
            .iter()
            .any(|c| c.class == ColumnClass::Personal));
    }

    /// The lexer cases shared with the TypeScript guard (used by WP1).
    #[test]
    fn engine_cases_parse() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../src/analytics/engine/engine-cases.json"
        )))
        .unwrap();
        assert!(cases.len() > 50);
        for case in cases {
            assert!(case["sql"].is_string());
            assert!(case["expect"].is_string());
        }
    }
}
