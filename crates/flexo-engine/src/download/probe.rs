use crate::{
    network::binding::send_get,
    types::ProbeResult,
    Result,
};
use reqwest::header::{
    ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG,
    LAST_MODIFIED, RANGE,
};
use std::net::IpAddr;

pub async fn probe_url(url: &str, local_address: Option<IpAddr>) -> Result<ProbeResult> {
    // First try Range: bytes=0-0 to check range support without downloading entire file
    let probe_resp = send_get(url, local_address, |request| {
        request.header(RANGE, "bytes=0-0")
    })
    .await;

    let response = match probe_resp {
        Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 416 => resp,
        _ => {
            // Fallback: send standard GET without Range header in case server rejects bytes=0-0
            send_get(url, local_address, |request| request).await?
        }
    };

    let status = response.status();
    let headers = response.headers();

    let supports_ranges = status == reqwest::StatusCode::PARTIAL_CONTENT
        || headers.contains_key(CONTENT_RANGE)
        || headers
            .get(ACCEPT_RANGES)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.eq_ignore_ascii_case("bytes"));

    let total_bytes = headers
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit('/').next())
        .and_then(|v| v.parse().ok())
        .or_else(|| {
            headers
                .get(CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok())
        });

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

    let suggested_file_name = ensure_extension(&raw_name, content_type.as_deref());

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
        crate::EngineError::Message(format!(
            "server responded with status {} for {url}: {error}",
            status.as_u16()
        ))
    })?;

    Ok(result)
}

fn extract_filename_from_disposition(disposition: &str) -> Option<String> {
    for part in disposition.split(';') {
        let trimmed = part.trim();
        // RFC 5987 / RFC 6266 filename*=UTF-8''...
        if let Some(rest) = trimmed.strip_prefix("filename*=") {
            let encoded = rest.trim().trim_matches('"');
            let value = if let Some(stripped) = encoded.strip_prefix("UTF-8''").or_else(|| encoded.strip_prefix("utf-8''")) {
                stripped
            } else {
                encoded
            };
            let decoded = decode_percent(value);
            if !decoded.is_empty() {
                return Some(decoded);
            }
        }
        if let Some(rest) = trimmed.strip_prefix("filename=") {
            let name = rest.trim().trim_matches('"').to_owned();
            if !name.is_empty() {
                return Some(decode_percent(&name));
            }
        }
    }
    None
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
