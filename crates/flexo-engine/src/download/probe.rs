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
    let response = send_get(url, local_address, |request| {
        request.header(RANGE, "bytes=0-0")
    })
    .await?;

    let status = response.status();
    let headers = response.headers();
    let supports_ranges = status == reqwest::StatusCode::PARTIAL_CONTENT
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
    let suggested_file_name = header(CONTENT_DISPOSITION)
        .and_then(|value| {
            value
                .split(';')
                .find_map(|part| part.trim().strip_prefix("filename="))
                .map(|name| name.trim_matches('"').to_owned())
        })
        .or_else(|| {
            response
                .url()
                .path_segments()?
                .next_back()
                .filter(|v| !v.is_empty())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "download".to_owned());
    let result = ProbeResult {
        requested_url: url.to_owned(),
        final_url: response.url().to_string(),
        total_bytes,
        supports_ranges,
        suggested_file_name,
        content_type: header(CONTENT_TYPE),
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
