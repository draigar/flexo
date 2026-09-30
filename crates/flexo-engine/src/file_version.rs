use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileVersion {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VersionCheck {
    Same,
    Size { detail: String },
    Validators { detail: String },
}

pub fn normalize_etag(etag: &str) -> String {
    let mut value = etag.trim();
    if value.len() >= 2 && value[..2].eq_ignore_ascii_case("w/") {
        value = &value[2..];
    }
    if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
        value = &value[1..value.len() - 1];
    }
    let lower = value.to_ascii_lowercase();
    for suffix in [
        "-gzip", ";gzip", "-br", ";br", "-deflate", ";deflate", "-zstd", ";zstd",
    ] {
        if lower.ends_with(suffix) {
            return value[..value.len() - suffix.len()].to_owned();
        }
    }
    value.to_owned()
}

pub fn compare_version(accepted: &[FileVersion], seen: &FileVersion) -> VersionCheck {
    let expected = accepted
        .first()
        .map(|version| version.total_bytes)
        .unwrap_or(0);
    if expected > 0 && seen.total_bytes > 0 && expected != seen.total_bytes {
        return VersionCheck::Size {
            detail: format!("it is now {} bytes instead of {expected}", seen.total_bytes),
        };
    }
    let etags: Vec<_> = accepted
        .iter()
        .filter_map(|version| version.etag.as_deref())
        .map(normalize_etag)
        .collect();
    if let Some(etag) = &seen.etag {
        if !etags.is_empty() {
            return if etags.contains(&normalize_etag(etag)) {
                VersionCheck::Same
            } else {
                VersionCheck::Validators {
                    detail: format!("its ETag is now {etag}"),
                }
            };
        }
    }
    let dates: Vec<_> = accepted
        .iter()
        .filter_map(|version| version.last_modified.as_deref())
        .collect();
    if let Some(date) = &seen.last_modified {
        if !dates.is_empty() && !dates.contains(&date.as_str()) {
            return VersionCheck::Validators {
                detail: format!("it was modified at {date}"),
            };
        }
    }
    VersionCheck::Same
}

#[cfg(test)]
mod tests {
    use super::*;
    fn version(etag: Option<&str>, date: Option<&str>, size: u64) -> FileVersion {
        FileVersion {
            etag: etag.map(str::to_owned),
            last_modified: date.map(str::to_owned),
            total_bytes: size,
        }
    }
    #[test]
    fn normalizes_variants() {
        assert_eq!(normalize_etag(" W/\"abc-gzip\" "), "abc");
    }
    #[test]
    fn size_is_definitive() {
        assert!(matches!(
            compare_version(&[version(None, None, 10)], &version(None, None, 11)),
            VersionCheck::Size { .. }
        ));
    }
    #[test]
    fn matching_normalized_etag_is_same() {
        assert_eq!(
            compare_version(
                &[version(Some("\"abc\""), None, 10)],
                &version(Some("W/\"abc-gzip\""), None, 10)
            ),
            VersionCheck::Same
        );
    }
    #[test]
    fn changed_date_is_validator_hint() {
        assert!(matches!(
            compare_version(
                &[version(None, Some("a"), 10)],
                &version(None, Some("b"), 10)
            ),
            VersionCheck::Validators { .. }
        ));
    }
}
