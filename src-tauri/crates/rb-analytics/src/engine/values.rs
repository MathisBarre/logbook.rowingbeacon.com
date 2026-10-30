//! Conversions between SQLite values and JSON (plan 2.2 steps 10 and 11).
//! The node test engine (`nodeEngine.ts`) applies the same rules.

use rusqlite::types::{Value as SqlValue, ValueRef};
use serde_json::{Number, Value};

use crate::error::{AnalyticsError, ErrorCode};

/// `Number.MAX_SAFE_INTEGER`: larger integers lose precision in JavaScript.
pub const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;
/// Text longer than this (in UTF-16 code units, like JavaScript) is cut.
pub const MAX_TEXT_UNITS: usize = 1000;
/// A cut text ends with this character.
pub const ELLIPSIS: char = '…';

/// A SQLite value as the webview receives it: integers outside ±(2^53 - 1)
/// become strings, NaN and infinite reals null, long text is cut with `…`,
/// blobs become `"[blob N octets]"`.
pub fn to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => {
            if (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&i) {
                Value::Number(i.into())
            } else {
                Value::String(i.to_string())
            }
        }
        ValueRef::Real(f) => Number::from_f64(f).map_or(Value::Null, Value::Number),
        ValueRef::Text(bytes) => Value::String(cut_text(&String::from_utf8_lossy(bytes))),
        ValueRef::Blob(bytes) => Value::String(format!("[blob {} octets]", bytes.len())),
    }
}

/// Keeps at most `MAX_TEXT_UNITS` UTF-16 code units, never splitting a
/// character, and appends `…` when something was cut.
pub fn cut_text(text: &str) -> String {
    let mut units = 0;
    for (index, c) in text.char_indices() {
        units += c.len_utf16();
        if units > MAX_TEXT_UNITS {
            let mut out = String::with_capacity(index + ELLIPSIS.len_utf8());
            out.push_str(&text[..index]);
            out.push(ELLIPSIS);
            return out;
        }
    }
    text.to_string()
}

/// Bytes the value takes in the JSON sent to the webview (close estimate:
/// escapes are not counted), plus one for the separator.
pub fn json_size(value: &Value) -> usize {
    1 + match value {
        Value::Null => 4,
        Value::Bool(_) => 5,
        Value::Number(n) => n.to_string().len(),
        Value::String(s) => s.len() + 2,
        // Results only hold the scalars above.
        other => other.to_string().len(),
    }
}

/// A request parameter as a SQLite value: null → NULL, boolean → 0/1,
/// integral number → integer, other number → real, string → text.
/// Arrays and objects are `invalid_param`.
pub fn param_to_sql(name: &str, value: Option<&Value>) -> Result<SqlValue, AnalyticsError> {
    let invalid = || {
        AnalyticsError::new(ErrorCode::InvalidParam, format!("Invalid value for {name}"))
            .with_object(name)
    };
    Ok(match value {
        None | Some(Value::Null) => SqlValue::Null,
        Some(Value::Bool(b)) => SqlValue::Integer(i64::from(*b)),
        Some(Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                let f = n.as_f64().filter(|f| f.is_finite()).ok_or_else(invalid)?;
                // 2^63 is exactly representable; `f < 2^63` keeps the cast exact.
                if f.fract() == 0.0 && f >= -(2f64.powi(63)) && f < 2f64.powi(63) {
                    SqlValue::Integer(f as i64)
                } else {
                    SqlValue::Real(f)
                }
            }
        }
        Some(Value::String(s)) => SqlValue::Text(s.clone()),
        Some(Value::Array(_)) | Some(Value::Object(_)) => return Err(invalid()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn converts_integers_at_the_safe_limit() {
        assert_eq!(
            to_json(ValueRef::Integer(MAX_SAFE_INTEGER)),
            json!(9007199254740991i64)
        );
        assert_eq!(
            to_json(ValueRef::Integer(-MAX_SAFE_INTEGER)),
            json!(-9007199254740991i64)
        );
        assert_eq!(
            to_json(ValueRef::Integer(MAX_SAFE_INTEGER + 1)),
            json!("9007199254740992")
        );
        assert_eq!(
            to_json(ValueRef::Integer(i64::MIN)),
            json!("-9223372036854775808")
        );
    }

    #[test]
    fn converts_reals_blobs_and_text() {
        assert_eq!(to_json(ValueRef::Real(1.5)), json!(1.5));
        assert_eq!(to_json(ValueRef::Real(f64::NAN)), Value::Null);
        assert_eq!(to_json(ValueRef::Real(f64::INFINITY)), Value::Null);
        assert_eq!(
            to_json(ValueRef::Blob(&[1, 2, 3])),
            json!("[blob 3 octets]")
        );
        assert_eq!(to_json(ValueRef::Text(b"abc")), json!("abc"));
        assert_eq!(to_json(ValueRef::Text(&[0x61, 0xff])), json!("a\u{fffd}"));
    }

    #[test]
    fn cuts_long_text_on_utf16_units() {
        let exact = "a".repeat(MAX_TEXT_UNITS);
        assert_eq!(cut_text(&exact), exact);
        let long = "é".repeat(MAX_TEXT_UNITS + 5);
        let cut = cut_text(&long);
        assert_eq!(cut.chars().count(), MAX_TEXT_UNITS + 1);
        assert!(cut.ends_with(ELLIPSIS));
        // A rower emoji is two UTF-16 units and is never split.
        let emoji = format!("{}🚣", "a".repeat(MAX_TEXT_UNITS - 1));
        assert_eq!(
            cut_text(&emoji),
            format!("{}…", "a".repeat(MAX_TEXT_UNITS - 1))
        );
    }

    #[test]
    fn binds_json_parameters() {
        assert_eq!(param_to_sql("a", None).unwrap(), SqlValue::Null);
        assert_eq!(
            param_to_sql("a", Some(&json!(null))).unwrap(),
            SqlValue::Null
        );
        assert_eq!(
            param_to_sql("a", Some(&json!(true))).unwrap(),
            SqlValue::Integer(1)
        );
        assert_eq!(
            param_to_sql("a", Some(&json!(false))).unwrap(),
            SqlValue::Integer(0)
        );
        assert_eq!(
            param_to_sql("a", Some(&json!(2025))).unwrap(),
            SqlValue::Integer(2025)
        );
        assert_eq!(
            param_to_sql("a", Some(&json!(2025.0))).unwrap(),
            SqlValue::Integer(2025)
        );
        assert_eq!(
            param_to_sql("a", Some(&json!(2.5))).unwrap(),
            SqlValue::Real(2.5)
        );
        assert_eq!(
            param_to_sql("a", Some(&json!(u64::MAX))).unwrap(),
            SqlValue::Real(u64::MAX as f64)
        );
        assert_eq!(
            param_to_sql("a", Some(&json!("x'; DROP"))).unwrap(),
            SqlValue::Text("x'; DROP".into())
        );
        for bad in [json!([1]), json!({ "a": 1 })] {
            let error = param_to_sql("boat", Some(&bad)).unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidParam);
            assert_eq!(error.object.as_deref(), Some("boat"));
        }
    }

    #[test]
    fn estimates_json_size() {
        assert_eq!(json_size(&json!(null)), 5);
        assert_eq!(json_size(&json!("abc")), 6);
        assert_eq!(json_size(&json!(12)), 3);
    }
}
