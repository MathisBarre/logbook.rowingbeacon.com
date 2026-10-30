//! Rust check of a chart proposed through MCP (`propose_chart`), mirroring
//! the zod `ChartSpec` of `src/analytics/chartSpec.ts` (plan 2.7). The app
//! re-validates with zod when it imports the proposal (WP6); this check
//! gives Claude an immediate, precise error instead of a proposal the user
//! would see as "Graphique illisible". Unknown keys are ignored, as zod
//! strips them.

use serde_json::{Map, Value};

pub const VALUE_FORMATS: [&str; 16] = [
    "auto", "integer", "decimal", "percent", "km", "hours", "minutes", "date", "datetime", "month",
    "week", "weekday", "hour", "season", "code", "text",
];

pub const CHART_TYPES: [&str; 8] = [
    "table", "kpi", "bar", "line", "area", "pie", "heatmap", "calendar",
];

pub const PARAM_TYPES: [&str; 11] = [
    "season",
    "date",
    "boat",
    "rower",
    "route",
    "outing_type",
    "boat_class",
    "integer",
    "choice",
    "boolean",
    "text",
];

/// `^[A-Za-z_][A-Za-z0-9_]{0,63}$`.
pub fn is_column_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && name.len() <= 64
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// `^[a-z][a-z0-9_]{0,31}$`.
pub fn is_param_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase())
        && name.len() <= 32
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// `^analytics\.[A-Za-z0-9_.{}]+$`.
fn is_label_key(key: &str) -> bool {
    key.strip_prefix("analytics.").is_some_and(|rest| {
        !rest.is_empty()
            && rest
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '{' | '}'))
    })
}

struct Checker<'a> {
    spec: &'a Map<String, Value>,
    columns: Vec<String>,
}

impl<'a> Checker<'a> {
    fn column(&mut self, field: &str, required: bool) -> Result<(), String> {
        match self.spec.get(field) {
            None | Some(Value::Null) if !required => Ok(()),
            None | Some(Value::Null) => Err(format!("chart.{field} is required (a column name)")),
            Some(Value::String(name)) if is_column_name(name) => {
                self.columns.push(name.clone());
                Ok(())
            }
            Some(other) => Err(format!(
                "chart.{field} must be a column name (letters, digits, _), got {other}"
            )),
        }
    }

    fn columns_list(
        &mut self,
        field: &str,
        min: usize,
        max: usize,
        required: bool,
    ) -> Result<usize, String> {
        match self.spec.get(field) {
            None | Some(Value::Null) if !required => Ok(0),
            Some(Value::Array(items)) if (min..=max).contains(&items.len()) => {
                for (index, item) in items.iter().enumerate() {
                    match item.as_str() {
                        Some(name) if is_column_name(name) => self.columns.push(name.to_string()),
                        _ => return Err(format!("chart.{field}[{index}] must be a column name")),
                    }
                }
                Ok(items.len())
            }
            _ => Err(format!(
                "chart.{field} must be an array of {min} to {max} column names"
            )),
        }
    }

    fn optional_bool(&self, field: &str) -> Result<(), String> {
        match self.spec.get(field) {
            None | Some(Value::Null) | Some(Value::Bool(_)) => Ok(()),
            Some(_) => Err(format!("chart.{field} must be true or false")),
        }
    }

    fn optional_enum(&self, field: &str, values: &[&str]) -> Result<(), String> {
        match self.spec.get(field) {
            None | Some(Value::Null) => Ok(()),
            Some(Value::String(value)) if values.contains(&value.as_str()) => Ok(()),
            Some(_) => Err(format!(
                "chart.{field} must be one of {}",
                values.join(", ")
            )),
        }
    }

    fn optional_text(&self, field: &str, max: usize) -> Result<(), String> {
        match self.spec.get(field) {
            None | Some(Value::Null) => Ok(()),
            Some(Value::String(text)) if text.chars().count() <= max => Ok(()),
            Some(_) => Err(format!(
                "chart.{field} must be a text of at most {max} characters"
            )),
        }
    }

    /// `labels`, `labelKeys`, `formats`: records keyed by column name.
    fn record(
        &mut self,
        field: &str,
        check: impl Fn(&Value) -> bool,
        what: &str,
    ) -> Result<(), String> {
        match self.spec.get(field) {
            None | Some(Value::Null) => Ok(()),
            Some(Value::Object(map)) => {
                for (column, value) in map {
                    if !is_column_name(column) {
                        return Err(format!("chart.{field}: {column:?} is not a column name"));
                    }
                    if !check(value) {
                        return Err(format!("chart.{field}.{column} must be {what}"));
                    }
                }
                Ok(())
            }
            Some(_) => Err(format!(
                "chart.{field} must be an object keyed by column name"
            )),
        }
    }

    fn labels(&mut self) -> Result<(), String> {
        self.optional_text("title", 120)?;
        self.optional_text("note", 300)?;
        self.record(
            "labels",
            |v| v.as_str().is_some_and(|s| s.chars().count() <= 60),
            "a text of at most 60 characters",
        )?;
        self.record(
            "labelKeys",
            |v| v.as_str().is_some_and(is_label_key),
            "an analytics.* translation key",
        )?;
        self.record(
            "formats",
            |v| v.as_str().is_some_and(|s| VALUE_FORMATS.contains(&s)),
            &format!("one of {}", VALUE_FORMATS.join(", ")),
        )
    }

    fn series_needs_one_y(&self, y_count: usize) -> Result<(), String> {
        let has_series = matches!(self.spec.get("series"), Some(Value::String(_)));
        if has_series && y_count != 1 {
            return Err("chart.series needs exactly one column in chart.y".into());
        }
        Ok(())
    }

    fn kpi_items(&mut self) -> Result<(), String> {
        let items = match self.spec.get("items") {
            Some(Value::Array(items)) if (1..=6).contains(&items.len()) => items,
            _ => return Err("chart.items must be an array of 1 to 6 KPI items".into()),
        };
        for (index, item) in items.iter().enumerate() {
            let item = item
                .as_object()
                .ok_or_else(|| format!("chart.items[{index}] must be an object"))?;
            for (field, required) in [("value", true), ("compare", false)] {
                match item.get(field) {
                    None | Some(Value::Null) if !required => {}
                    Some(Value::String(name)) if is_column_name(name) => {
                        self.columns.push(name.clone())
                    }
                    _ => {
                        return Err(format!(
                            "chart.items[{index}].{field} must be a column name"
                        ))
                    }
                }
            }
            match item.get("format") {
                None | Some(Value::Null) => {}
                Some(Value::String(format)) if VALUE_FORMATS.contains(&format.as_str()) => {}
                _ => return Err(format!("chart.items[{index}].format is not a known format")),
            }
            for field in ["higherIsBetter", "hideWhenNull"] {
                if !matches!(
                    item.get(field),
                    None | Some(Value::Null) | Some(Value::Bool(_))
                ) {
                    return Err(format!(
                        "chart.items[{index}].{field} must be true or false"
                    ));
                }
            }
            match item.get("label") {
                None | Some(Value::Null) => {}
                Some(Value::String(label)) if label.chars().count() <= 60 => {}
                _ => {
                    return Err(format!(
                        "chart.items[{index}].label must be at most 60 characters"
                    ))
                }
            }
        }
        Ok(())
    }
}

/// Checks a ChartSpec and returns the result columns it references, so the
/// caller can compare them with the columns the SQL returns.
pub fn check_chart(spec: &Value) -> Result<Vec<String>, String> {
    let map = spec
        .as_object()
        .ok_or_else(|| "chart must be an object".to_string())?;
    let chart_type = map
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("chart.type is required: one of {}", CHART_TYPES.join(", ")))?;
    let mut checker = Checker {
        spec: map,
        columns: Vec::new(),
    };
    match chart_type {
        "table" => {
            checker.columns_list("columns", 0, 50, false)?;
        }
        "kpi" => checker.kpi_items()?,
        "bar" => {
            checker.column("x", true)?;
            let y = checker.columns_list("y", 1, 8, true)?;
            checker.column("series", false)?;
            checker.series_needs_one_y(y)?;
            checker.optional_enum("orientation", &["vertical", "horizontal"])?;
            checker.optional_bool("stacked")?;
            checker.optional_enum("sort", &["none", "asc", "desc"])?;
            match map.get("limit") {
                None | Some(Value::Null) => {}
                Some(Value::Number(n)) if n.as_u64().is_some_and(|n| (1..=100).contains(&n)) => {}
                Some(_) => return Err("chart.limit must be an integer from 1 to 100".into()),
            }
        }
        "line" | "area" => {
            checker.column("x", true)?;
            let y = checker.columns_list("y", 1, 8, true)?;
            checker.column("series", false)?;
            checker.series_needs_one_y(y)?;
            checker.optional_bool("cumulative")?;
        }
        "pie" => {
            checker.column("label", true)?;
            checker.column("value", true)?;
        }
        "heatmap" => {
            checker.column("x", true)?;
            checker.column("y", true)?;
            checker.column("value", true)?;
        }
        "calendar" => {
            checker.column("date", true)?;
            checker.column("value", true)?;
        }
        other => {
            return Err(format!(
                "chart.type {other:?} is unknown: use one of {}",
                CHART_TYPES.join(", ")
            ))
        }
    }
    checker.labels()?;
    let mut columns = checker.columns;
    columns.dedup();
    Ok(columns)
}

/// Checks a `ParamDef[]` (plan 2.7), loosely: what WP6's zod parse needs.
pub fn check_params(params: &Value) -> Result<(), String> {
    let list = match params {
        Value::Null => return Ok(()),
        Value::Array(list) => list,
        _ => return Err("params must be an array of parameter definitions".into()),
    };
    if list.len() > 20 {
        return Err("params: at most 20 parameters".into());
    }
    let mut names = Vec::new();
    for (index, param) in list.iter().enumerate() {
        let param = param
            .as_object()
            .ok_or_else(|| format!("params[{index}] must be an object"))?;
        let name = param
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| is_param_name(name))
            .ok_or_else(|| format!("params[{index}].name must match ^[a-z][a-z0-9_]{{0,31}}$"))?;
        if names.contains(&name) {
            return Err(format!("params: {name} is defined twice"));
        }
        names.push(name);
        if !param
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|t| PARAM_TYPES.contains(&t))
        {
            return Err(format!(
                "params[{index}].type must be one of {}",
                PARAM_TYPES.join(", ")
            ));
        }
        match param.get("label") {
            None | Some(Value::Null) => {}
            Some(Value::String(label)) if label.chars().count() <= 60 => {}
            _ => {
                return Err(format!(
                    "params[{index}].label must be at most 60 characters"
                ))
            }
        }
        if !matches!(
            param.get("required"),
            None | Some(Value::Null) | Some(Value::Bool(_))
        ) {
            return Err(format!("params[{index}].required must be true or false"));
        }
        if matches!(
            param.get("default"),
            Some(Value::Array(_) | Value::Object(_))
        ) {
            return Err(format!(
                "params[{index}].default must be a text, a number, true/false or null"
            ));
        }
        match param.get("options") {
            None | Some(Value::Null) => {}
            Some(Value::Array(options)) if options.len() <= 30 => {
                for option in options {
                    if !option.get("value").is_some_and(Value::is_string) {
                        return Err(format!(
                            "params[{index}].options: each option needs a text value"
                        ));
                    }
                }
            }
            _ => return Err(format!("params[{index}].options: at most 30 options")),
        }
        for field in ["min", "max"] {
            if !matches!(
                param.get(field),
                None | Some(Value::Null) | Some(Value::Number(_))
            ) {
                return Err(format!("params[{index}].{field} must be a number"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_every_catalog_chart() {
        for entry in crate::assets::catalog() {
            check_chart(&entry.chart).unwrap_or_else(|e| panic!("{}: {e}", entry.id));
            check_params(&entry.params).unwrap_or_else(|e| panic!("{}: {e}", entry.id));
        }
    }

    #[test]
    fn returns_referenced_columns() {
        let spec = json!({ "type": "bar", "x": "boat_name", "y": ["outings"], "orientation": "horizontal" });
        assert_eq!(check_chart(&spec).unwrap(), vec!["boat_name", "outings"]);
        let spec = json!({ "type": "kpi", "items": [{ "value": "km", "compare": "km_prev", "format": "km" }] });
        assert_eq!(check_chart(&spec).unwrap(), vec!["km", "km_prev"]);
        assert_eq!(
            check_chart(&json!({ "type": "table" })).unwrap(),
            Vec::<String>::new()
        );
    }

    #[test]
    fn rejects_bad_shapes() {
        let cases = [
            (json!([]), "must be an object"),
            (json!({}), "chart.type is required"),
            (json!({ "type": "radar" }), "unknown"),
            (json!({ "type": "bar", "y": ["a"] }), "chart.x is required"),
            (json!({ "type": "bar", "x": "a", "y": [] }), "1 to 8"),
            (
                json!({ "type": "bar", "x": "a", "y": ["b", "c"], "series": "d" }),
                "exactly one",
            ),
            (
                json!({ "type": "bar", "x": "a b", "y": ["c"] }),
                "column name",
            ),
            (
                json!({ "type": "bar", "x": "a", "y": ["c"], "limit": 0 }),
                "limit",
            ),
            (
                json!({ "type": "bar", "x": "a", "y": ["c"], "sort": "up" }),
                "sort",
            ),
            (
                json!({ "type": "line", "x": "a", "y": ["c"], "cumulative": "yes" }),
                "true or false",
            ),
            (
                json!({ "type": "pie", "label": "a" }),
                "chart.value is required",
            ),
            (json!({ "type": "kpi", "items": [] }), "1 to 6"),
            (
                json!({ "type": "kpi", "items": [{ "value": "a", "format": "money" }] }),
                "format",
            ),
            (
                json!({ "type": "table", "formats": { "a": "money" } }),
                "formats.a",
            ),
            (
                json!({ "type": "table", "labels": { "a b": "x" } }),
                "not a column name",
            ),
            (
                json!({ "type": "table", "labelKeys": { "a": "other.key" } }),
                "translation key",
            ),
            (json!({ "type": "table", "title": "x".repeat(121) }), "120"),
        ];
        for (spec, expected) in cases {
            let error = check_chart(&spec).unwrap_err();
            assert!(error.contains(expected), "{spec}: {error}");
        }
    }

    #[test]
    fn ignores_unknown_keys_like_zod() {
        let spec = json!({ "type": "heatmap", "x": "hour", "y": "weekday", "value": "outings", "colour": "red" });
        assert_eq!(
            check_chart(&spec).unwrap(),
            vec!["hour", "weekday", "outings"]
        );
    }

    #[test]
    fn checks_params() {
        check_params(&json!([
            { "name": "season", "type": "season", "required": true, "default": "current" },
            { "name": "min_outings", "type": "integer", "default": 5, "min": 1, "max": 100 },
            { "name": "kind", "type": "choice", "options": [{ "value": "a", "label": "A" }] }
        ]))
        .unwrap();
        check_params(&Value::Null).unwrap();
        for (params, expected) in [
            (json!({}), "array"),
            (json!([{ "name": "Season", "type": "season" }]), "name"),
            (json!([{ "name": "a", "type": "colour" }]), "type"),
            (
                json!([{ "name": "a", "type": "text" }, { "name": "a", "type": "text" }]),
                "twice",
            ),
            (
                json!([{ "name": "a", "type": "text", "default": [1] }]),
                "default",
            ),
            (
                json!([{ "name": "a", "type": "choice", "options": [{ "label": "x" }] }]),
                "option",
            ),
        ] {
            let error = check_params(&params).unwrap_err();
            assert!(error.contains(expected), "{params}: {error}");
        }
    }

    #[test]
    fn name_rules() {
        assert!(is_column_name("_x1") && is_column_name("A") && !is_column_name("1a"));
        assert!(!is_column_name(&"a".repeat(65)) && is_column_name(&"a".repeat(64)));
        assert!(is_param_name("season") && !is_param_name("Season") && !is_param_name("_a"));
        assert!(!is_param_name(&"a".repeat(33)));
    }
}
