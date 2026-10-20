use crate::{
    network::binding::send_get,
    types::{ProbeResult, RequestHeaders},
    Result,
};
use reqwest::header::{
    ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG,
    LAST_MODIFIED, RANGE,
};
use std::net::IpAddr;

pub async fn probe_url(url: &str, local_address: Option<IpAddr>) -> Result<ProbeResult> {
    probe_url_with_headers(url, None, local_address).await
}

pub async fn probe_url_with_headers(
    url: &str,
    req_headers: Option<&RequestHeaders>,
    local_address: Option<IpAddr>,
) -> Result<ProbeResult> {
    let apply_headers = |mut request: reqwest::RequestBuilder| {
        if let Some(h) = req_headers {
            if let Some(ref referer) = h.referer {
                if !referer.is_empty() {
                    request = request.header(reqwest::header::REFERER, referer);
                }
            }
            if let Some(ref cookies) = h.cookies {
                if !cookies.is_empty() {
                    request = request.header(reqwest::header::COOKIE, cookies);
                }
            }
            if let Some(ref ua) = h.user_agent {
                if !ua.is_empty() {
                    request = request.header(reqwest::header::USER_AGENT, ua);
                }
            }
        }
        request
    };

    // First try Range: bytes=0-1023 (1 KiB) to check range support without downloading entire file
    // Some hosts answer a range that ends at byte 0 or 1 with the whole file or close connection.
    let probe_resp = send_get(url, local_address, |request| {
        apply_headers(request.header(RANGE, "bytes=0-1023"))
    })
    .await;

    let response = match probe_resp {
        Ok(resp) if resp.status().as_u16() == 403 => {
            // Some servers refuse Range request or need GET without range.
            let fallback = send_get(url, local_address, |request| apply_headers(request)).await?;
            if fallback.status().as_u16() == 403 && req_headers.and_then(|h| h.referer.as_ref()).is_none() {
                // If 403 persists and no Referer was supplied, try domain origin as Referer fallback
                if let Ok(parsed) = reqwest::Url::parse(url) {
                    if let Some(host) = parsed.host_str() {
                        let origin = format!("{}://{}/", parsed.scheme(), host);
                        if let Ok(origin_resp) = send_get(url, local_address, |req| {
                            apply_headers(req).header(reqwest::header::REFERER, &origin)
                        }).await {
                            if origin_resp.status().is_success() {
                                origin_resp
                            } else {
                                fallback
                            }
                        } else {
                            fallback
                        }
                    } else {
                        fallback
                    }
                } else {
                    fallback
                }
            } else {
                fallback
            }
        }
        Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 416 => resp,
        _ => {
            // Fallback: send standard GET without Range header in case server rejects bytes=0-1023
            send_get(url, local_address, |request| apply_headers(request)).await?
        }
    };

    let status = response.status();
    let headers = response.headers();

    let total_bytes = headers
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit('/').next())
        .and_then(|v| v.parse().ok())
        .or_else(|| {
            if status == reqwest::StatusCode::OK {
                headers
                    .get(CONTENT_LENGTH)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse().ok())
            } else {
                None
            }
        });

    // A server genuinely supports ranges if it answered with 206 Partial Content,
    // or answered with Content-Range, or explicitly declared Accept-Ranges: bytes.
    let supports_ranges = status == reqwest::StatusCode::PARTIAL_CONTENT
        || (headers.contains_key(CONTENT_RANGE) && status.is_success())
        || (headers
            .get(ACCEPT_RANGES)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.eq_ignore_ascii_case("bytes"))
            && total_bytes.is_some_and(|len| len > 0));

    let header = |name| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };

    let content_type = header(CONTENT_TYPE);

    let raw_name = header(CONTENT_DISPOSITION)
        .and_then(|val| extract_filename_from_disposition(&val))
        .or_else(|| {
            response
                .url()
                .path_segments()?
                .next_back()
                .filter(|v| !v.is_empty())
                .map(decode_percent)
        })
        .unwrap_or_else(|| "download".to_owned());

    let sanitized_name = sanitize_filename(&raw_name);
    let suggested_file_name = ensure_extension(&sanitized_name, content_type.as_deref());

    let result = ProbeResult {
        requested_url: url.to_owned(),
        final_url: response.url().to_string(),
        total_bytes,
        supports_ranges,
        suggested_file_name,
        content_type,
        etag: header(ETAG),
        last_modified: header(LAST_MODIFIED),
    };

    // A 416 on an empty file with bytes */0 is a valid empty download — treat as success.
    if status.as_u16() == 416
        && headers
            .get(CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("bytes */0"))
    {
        return Ok(ProbeResult {
            supports_ranges: false,
            total_bytes: Some(0),
            ..result
        });
    }

    response.error_for_status().map_err(|error| {
        if status.as_u16() == 403 {
            crate::EngineError::Message(format!(
                "server responded with status 403 (Forbidden) for {url}. The server may require a Referer header (source webpage URL) or session cookies. {error}"
            ))
        } else {
            crate::EngineError::Message(format!(
                "server responded with status {} for {url}: {error}",
                status.as_u16()
            ))
        }
    })?;

    Ok(result)
}

pub fn extract_filename_from_disposition(disposition: &str) -> Option<String> {
    // RFC 6266 / RFC 5987 / RFC 2047 parser
    // First look for filename*= (extended attribute with charset)
    let extended_pattern = "filename*=";
    if let Some(pos) = disposition.find(extended_pattern) {
        let rest = &disposition[pos + extended_pattern.len()..];
        let end = rest.find(';').unwrap_or(rest.len());
        let val = rest[..end].trim().trim_matches('"');
        if let Some(idx1) = val.find('\'') {
            let charset = &val[..idx1];
            if let Some(idx2) = val[idx1 + 1..].find('\'') {
                let encoded_text = &val[idx1 + 1 + idx2 + 1..];
                if charset.eq_ignore_ascii_case("utf-8") {
                    let decoded = decode_percent(encoded_text);
                    if !decoded.is_empty() {
                        return Some(decoded);
                    }
                } else if charset.eq_ignore_ascii_case("iso-8859-1") {
                    let decoded = decode_percent_latin1(encoded_text);
                    if !decoded.is_empty() {
                        return Some(decoded);
                    }
                }
            }
        }
    }

    // Next look for filename="quoted" or filename=token
    let filename_pattern = "filename=";
    if let Some(pos) = disposition.find(filename_pattern) {
        let rest = &disposition[pos + filename_pattern.len()..];
        let trimmed = rest.trim();
        let value = if trimmed.starts_with('"') {
            // Read until next unescaped quote
            let mut end_idx = 1;
            let bytes = trimmed.as_bytes();
            let mut escaped = false;
            while end_idx < bytes.len() {
                if escaped {
                    escaped = false;
                } else if bytes[end_idx] == b'\\' {
                    escaped = true;
                } else if bytes[end_idx] == b'"' {
                    break;
                }
                end_idx += 1;
            }
            &trimmed[1..end_idx.min(trimmed.len())]
        } else {
            let end = trimmed.find(';').unwrap_or(trimmed.len());
            trimmed[..end].trim()
        };

        let unescaped = value.replace("\\\"", "\"").replace("\\\\", "\\");
        let decoded = decode_rfc2047(&decode_percent(&unescaped));
        if !decoded.is_empty() {
            return Some(decoded);
        }
    }

    None
}

/// Decode RFC 2047 encoded words: =?charset?B|Q?encoded_text?=
fn decode_rfc2047(text: &str) -> String {
    if !text.contains("=?") || !text.contains("?=") {
        return text.to_owned();
    }

    let mut result = String::new();
    let mut remainder = text;

    while let Some(start) = remainder.find("=?") {
        result.push_str(&remainder[..start]);
        let token_rem = &remainder[start + 2..];
        if let Some(end) = token_rem.find("?=") {
            let token_body = &token_rem[..end];
            // Format: charset?encoding?data
            let parts: Vec<&str> = token_body.splitn(3, '?').collect();
            if parts.len() == 3 {
                let charset = parts[0];
                let encoding = parts[1];
                let data = parts[2];

                let decoded_bytes: Option<Vec<u8>> = if encoding.eq_ignore_ascii_case("b") {
                    // Base64 decode
                    decode_base64(data)
                } else if encoding.eq_ignore_ascii_case("q") {
                    // Q-encoding: _ is space, =XX is hex byte
                    Some(decode_q_encoding(data))
                } else {
                    None
                };

                if let Some(bytes) = decoded_bytes {
                    if charset.eq_ignore_ascii_case("utf-8") {
                        if let Ok(s) = String::from_utf8(bytes) {
                            result.push_str(&s);
                            remainder = &token_rem[end + 2..];
                            continue;
                        }
                    } else if charset.eq_ignore_ascii_case("iso-8859-1") || charset.eq_ignore_ascii_case("latin1") {
                        let s: String = bytes.into_iter().map(|b| b as char).collect();
                        result.push_str(&s);
                        remainder = &token_rem[end + 2..];
                        continue;
                    }
                }
            }
            // If failed to parse as valid encoded word, keep raw
            result.push_str(&remainder[start..start + 2 + end + 2]);
            remainder = &token_rem[end + 2..];
        } else {
            result.push_str(&remainder[start..]);
            break;
        }
    }
    result.push_str(remainder);
    result
}

fn decode_base64(data: &str) -> Option<Vec<u8>> {
    let mut clean = String::new();
    for c in data.chars() {
        if c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=' {
            clean.push(c);
        }
    }
    let b64_table = |b: u8| -> Option<u8> {
        match b {
            b'A'..=b'Z' => Some(b - b'A'),
            b'a'..=b'z' => Some(b - b'a' + 26),
            b'0'..=b'9' => Some(b - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let bytes = clean.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        if chunk.len() < 2 {
            break;
        }
        let b0 = b64_table(chunk[0])?;
        let b1 = b64_table(chunk[1])?;
        out.push((b0 << 2) | (b1 >> 4));
        if chunk.len() > 2 && chunk[2] != b'=' {
            let b2 = b64_table(chunk[2])?;
            out.push(((b1 & 0xF) << 4) | (b2 >> 2));
            if chunk.len() > 3 && chunk[3] != b'=' {
                let b3 = b64_table(chunk[3])?;
                out.push(((b2 & 0x3) << 6) | b3);
            }
        }
    }
    Some(out)
}

fn decode_q_encoding(data: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let bytes = data.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'_' {
            out.push(b' ');
            i += 1;
        } else if bytes[i] == b'=' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..=i + 2]).unwrap_or(""), 16) {
                out.push(val);
                i += 3;
            } else {
                out.push(bytes[i]);
                i += 1;
            }
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    out
}

fn decode_percent(s: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(h1), Some(h2)) = (h1, h2) {
                if let Ok(val) = u8::from_str_radix(
                    std::str::from_utf8(&[h1, h2]).unwrap_or(""),
                    16,
                ) {
                    bytes.push(val);
                    continue;
                }
            }
        }
        bytes.push(b);
    }
    String::from_utf8(bytes).unwrap_or_else(|_| s.to_owned())
}

fn decode_percent_latin1(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(h1), Some(h2)) = (h1, h2) {
                if let Ok(val) = u8::from_str_radix(
                    std::str::from_utf8(&[h1, h2]).unwrap_or(""),
                    16,
                ) {
                    out.push(val as char);
                    continue;
                }
            }
        }
        out.push(b as char);
    }
    out
}

/// Shortens overly long filenames safely while preserving the extension
fn sanitize_filename(name: &str) -> String {
    let clean = name.replace(['/', '\\', '\0', ':', '*', '?', '"', '<', '>', '|'], "_");
    if clean.len() <= 200 {
        return clean;
    }
    if let Some(dot_idx) = clean.rfind('.') {
        let ext = &clean[dot_idx..];
        let base = &clean[..dot_idx];
        let max_base_len = 200usize.saturating_sub(ext.len()).max(10);
        let truncated_base = &base[..max_base_len.min(base.len())];
        format!("{truncated_base}{ext}")
    } else {
        clean[..200.min(clean.len())].to_owned()
    }
}

fn ensure_extension(name: &str, content_type: Option<&str>) -> String {
    if name.contains('.') && !name.ends_with('.') {
        return name.to_owned();
    }
    let Some(ct) = content_type else {
        return name.to_owned();
    };
    let ext = match ct.split(';').next().map(str::trim) {
        Some("video/mp4") => ".mp4",
        Some("video/x-matroska") => ".mkv",
        Some("video/webm") => ".webm",
        Some("video/quicktime") => ".mov",
        Some("video/x-msvideo") => ".avi",
        Some("video/mpeg") => ".mpg",
        Some("audio/mpeg" | "audio/mp3") => ".mp3",
        Some("audio/aac") => ".aac",
        Some("audio/flac") => ".flac",
        Some("application/pdf") => ".pdf",
        Some("application/zip") => ".zip",
        Some("application/x-7z-compressed") => ".7z",
        Some("application/x-rar-compressed" | "application/vnd.rar") => ".rar",
        _ => return name.to_owned(),
    };
    format!("{name}{ext}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rfc5987_utf8_and_iso8859_1() {
        let utf8_disp = "attachment; filename*=UTF-8''%E2%82%AC%20rates.pdf";
        assert_eq!(extract_filename_from_disposition(utf8_disp), Some("€ rates.pdf".to_owned()));

        let latin1_disp = "attachment; filename*=iso-8859-1''%A3%20rates.pdf";
        assert_eq!(extract_filename_from_disposition(latin1_disp), Some("£ rates.pdf".to_owned()));
    }

    #[test]
    fn parses_rfc2047_encoded_words() {
        let rfc2047_b = "attachment; filename=\"=?UTF-8?B?UmF0ZXMgKDIwMjYpLnBkZg==?=\"";
        assert_eq!(extract_filename_from_disposition(rfc2047_b), Some("Rates (2026).pdf".to_owned()));

        let rfc2047_q = "attachment; filename=\"=?UTF-8?Q?Rates_=282026=29.pdf?=\"";
        assert_eq!(extract_filename_from_disposition(rfc2047_q), Some("Rates (2026).pdf".to_owned()));
    }

    #[test]
    fn sanitizes_and_truncates_long_names() {
        let long_name = format!("{}.pdf", "a".repeat(250));
        let sanitized = sanitize_filename(&long_name);
        assert!(sanitized.len() <= 200);
        assert!(sanitized.ends_with(".pdf"));
    }
}
