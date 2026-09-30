use crate::{network::binding::send_get, EngineError, Result};
use futures::StreamExt;
use reqwest::header::RANGE;
use std::{net::IpAddr, path::Path};
use tokio::{fs::OpenOptions, io::AsyncWriteExt};
use tokio_util::sync::CancellationToken;

pub async fn download_range(
    url: &str,
    start: u64,
    end: u64,
    part_path: &Path,
    local_address: Option<IpAddr>,
    cancel: CancellationToken,
    mut on_progress: impl FnMut(u64) + Send,
) -> Result<u64> {
    let response = send_get(url, local_address, |request| {
        request.header(RANGE, format!("bytes={start}-{end}"))
    })
    .await?;

    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT && start != 0 {
        return Err(EngineError::Message(format!(
            "server ignored range request: {}",
            response.status()
        )));
    }
    let response = response.error_for_status()?;
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(part_path)
        .await?;
    let mut stream = response.bytes_stream();
    let mut written = 0;
    loop {
        tokio::select! {
            _ = cancel.cancelled() => return Err(EngineError::Cancelled),
            item = stream.next() => match item {
                Some(bytes) => {
                    let bytes = bytes?;
                    file.write_all(&bytes).await?;
                    written += bytes.len() as u64;
                    on_progress(written);
                }
                None => break,
            }
        }
    }
    file.flush().await?;
    let expected = end - start + 1;
    if written != expected {
        return Err(EngineError::Message(format!(
            "range returned {written} bytes; expected {expected}"
        )));
    }
    Ok(written)
}
