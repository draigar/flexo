use crate::{network::binding::send_get, EngineError, Result};
use futures::StreamExt;
use reqwest::header::RANGE;
use std::{net::IpAddr, path::Path, time::Duration};
use tokio::{
    fs::OpenOptions,
    io::{AsyncSeekExt, AsyncWriteExt, SeekFrom},
};
use tokio_util::sync::CancellationToken;

const CHUNK_READ_TIMEOUT_SECS: u64 = 45;
const MAX_RETRIES: usize = 8;
/// Maximum wait when the server sends a 429 Too Many Requests
const MAX_RATE_LIMIT_BACKOFF_SECS: u64 = 60;

pub async fn download_range(
    url: &str,
    start: u64,
    end: u64,
    part_path: &Path,
    local_address: Option<IpAddr>,
    cancel: CancellationToken,
    mut on_progress: impl FnMut(u64) + Send,
) -> Result<u64> {
    let expected = end.saturating_sub(start) + 1;

    // Check if the file already exists and is complete on disk.
    let existing_len = match tokio::fs::metadata(part_path).await {
        Ok(meta) => meta.len(),
        Err(_) => 0,
    };

    if existing_len >= expected {
        if existing_len > expected {
            if let Ok(file) = OpenOptions::new().write(true).open(part_path).await {
                let _ = file.set_len(expected).await;
            }
        }
        on_progress(expected);
        return Ok(expected);
    }

    let mut last_error = None;

    for attempt in 0..=MAX_RETRIES {
        if cancel.is_cancelled() {
            return Err(EngineError::Cancelled);
        }

        // Current length on disk for this block
        let current_len = match tokio::fs::metadata(part_path).await {
            Ok(meta) => meta.len(),
            Err(_) => 0,
        };

        if current_len >= expected {
            if current_len > expected {
                if let Ok(file) = OpenOptions::new().write(true).open(part_path).await {
                    let _ = file.set_len(expected).await;
                }
            }
            on_progress(expected);
            return Ok(expected);
        }

        // Request the remaining range from where we left off
        let req_start = start + current_len;
        let req_end = end;

        let response = match send_get(url, local_address, |request| {
            request.header(RANGE, format!("bytes={req_start}-{req_end}"))
        })
        .await
        {
            Ok(resp) => resp,
            Err(err) => {
                last_error = Some(err);
                if attempt < MAX_RETRIES {
                    let backoff = Duration::from_millis(500 * (1 << attempt).min(8000));
                    tokio::select! {
                        _ = cancel.cancelled() => return Err(EngineError::Cancelled),
                        _ = tokio::time::sleep(backoff) => continue,
                    }
                }
                break;
            }
        };

        let status = response.status();

        // 416 Range Not Satisfiable: could mean file is already complete or offset is out of range.
        if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            if current_len >= expected {
                on_progress(expected);
                return Ok(expected);
            }
            // Truncate to 0 and start from beginning on next attempt
            if let Ok(file) = OpenOptions::new().write(true).truncate(true).open(part_path).await {
                drop(file);
            }
            continue;
        }

        // 429 Too Many Requests – honour Retry-After if present, otherwise back off
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0)
                .min(MAX_RATE_LIMIT_BACKOFF_SECS)
                .max(5); // always wait at least 5 s
            last_error = Some(EngineError::Message(format!(
                "rate limited (429), retrying in {retry_after}s (attempt {}/{MAX_RETRIES})",
                attempt + 1
            )));
            if attempt < MAX_RETRIES {
                tokio::select! {
                    _ = cancel.cancelled() => return Err(EngineError::Cancelled),
                    _ = tokio::time::sleep(Duration::from_secs(retry_after)) => continue,
                }
            }
            break;
        }

        // 5xx server errors – transient, back off and retry
        if status.is_server_error() {
            last_error = Some(EngineError::Message(format!(
                "server error {status} for bytes={req_start}-{req_end}, retrying (attempt {}/{MAX_RETRIES})",
                attempt + 1
            )));
            if attempt < MAX_RETRIES {
                let backoff = Duration::from_millis(1000 * (1 << attempt.min(5)));
                tokio::select! {
                    _ = cancel.cancelled() => return Err(EngineError::Cancelled),
                    _ = tokio::time::sleep(backoff) => continue,
                }
            }
            break;
        }

        // 404 – the token may be temporary (Cloudflare Workers) so retry.
        // We propagate a distinct message so the manager's outer loop can re-probe.
        if status == reqwest::StatusCode::NOT_FOUND {
            last_error = Some(EngineError::Message(format!(
                "404 on bytes={req_start}-{req_end}: token may have expired, retrying (attempt {}/{MAX_RETRIES})",
                attempt + 1
            )));
            if attempt < MAX_RETRIES {
                let backoff = Duration::from_millis(1000 * (1 << attempt.min(5)));
                tokio::select! {
                    _ = cancel.cancelled() => return Err(EngineError::Cancelled),
                    _ = tokio::time::sleep(backoff) => continue,
                }
            }
            break;
        }

        // Range was ignored (server replied 200 instead of 206) – retry if possible
        if status != reqwest::StatusCode::PARTIAL_CONTENT && req_start != 0 {
            // Server ignored range request
            last_error = Some(EngineError::Message(format!(
                "server ignored range request for bytes={req_start}-{req_end}: {status}"
            )));
            if attempt < MAX_RETRIES {
                let backoff = Duration::from_millis(500 * (1 << attempt).min(8000));
                tokio::select! {
                    _ = cancel.cancelled() => return Err(EngineError::Cancelled),
                    _ = tokio::time::sleep(backoff) => continue,
                }
            }
            break;
        }

        let response = match response.error_for_status() {
            Ok(r) => r,
            Err(e) => {
                last_error = Some(EngineError::Http(e));
                if attempt < MAX_RETRIES {
                    let backoff = Duration::from_millis(500 * (1 << attempt).min(8000));
                    tokio::select! {
                        _ = cancel.cancelled() => return Err(EngineError::Cancelled),
                        _ = tokio::time::sleep(backoff) => continue,
                    }
                }
                break;
            }
        };

        let is_partial = status == reqwest::StatusCode::PARTIAL_CONTENT;
        let mut file = if is_partial && current_len > 0 {
            let mut f = OpenOptions::new()
                .create(true)
                .write(true)
                .open(part_path)
                .await?;
            f.seek(SeekFrom::Start(current_len)).await?;
            f
        } else {
            OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(part_path)
                .await?
        };

        let mut written = if is_partial { current_len } else { 0 };
        on_progress(written);

        let mut stream = response.bytes_stream();
        let mut stream_interrupted = false;

        loop {
            tokio::select! {
                _ = cancel.cancelled() => return Err(EngineError::Cancelled),
                item = tokio::time::timeout(Duration::from_secs(CHUNK_READ_TIMEOUT_SECS), stream.next()) => {
                    match item {
                        Ok(Some(Ok(bytes))) => {
                            if let Err(e) = file.write_all(&bytes).await {
                                last_error = Some(EngineError::Io(e));
                                stream_interrupted = true;
                                break;
                            }
                            written += bytes.len() as u64;
                            on_progress(written);
                            if written >= expected {
                                break;
                            }
                        }
                        Ok(Some(Err(err))) => {
                            last_error = Some(EngineError::Http(err));
                            stream_interrupted = true;
                            break;
                        }
                        Ok(None) => {
                            // Stream closed by server
                            if written < expected {
                                last_error = Some(EngineError::Message(format!(
                                    "server closed stream early ({written}/{expected} bytes)"
                                )));
                                stream_interrupted = true;
                            }
                            break;
                        }
                        Err(_) => {
                            // Timeout reading next chunk (inactivity)
                            last_error = Some(EngineError::Message("chunk read timed out (no data received)".into()));
                            stream_interrupted = true;
                            break;
                        }
                    }
                }
            }
        }

        let _ = file.flush().await;

        if written >= expected {
            if written > expected {
                let _ = file.set_len(expected).await;
            }
            return Ok(expected);
        }

        if cancel.is_cancelled() {
            return Err(EngineError::Cancelled);
        }

        if (stream_interrupted || written < expected) && attempt < MAX_RETRIES {
            let backoff = Duration::from_millis(500 * (1 << attempt).min(8000));
            tokio::select! {
                _ = cancel.cancelled() => return Err(EngineError::Cancelled),
                _ = tokio::time::sleep(backoff) => continue,
            }
        }
    }

    let final_len = match tokio::fs::metadata(part_path).await {
        Ok(meta) => meta.len(),
        Err(_) => 0,
    };

    if final_len >= expected {
        return Ok(expected);
    }

    Err(last_error.unwrap_or_else(|| {
        EngineError::Message(format!(
            "range returned {final_len} bytes; expected {expected}"
        ))
    }))
}
