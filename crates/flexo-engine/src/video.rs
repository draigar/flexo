use crate::{
    types::{MediaCandidate, MediaKind},
    EngineError, Result,
};
use serde_json::Value;
use std::path::Path;
use tokio::process::Command;
use url::Url;

pub fn resolve_progressive(
    url: &str,
    content_type: Option<&str>,
    total_bytes: Option<u64>,
) -> Result<MediaCandidate> {
    Url::parse(url)?;
    Ok(MediaCandidate {
        id: uuid::Uuid::new_v4().to_string(),
        url: url.to_owned(),
        title: None,
        kind: MediaKind::Progressive,
        quality: None,
        mime_type: content_type.map(str::to_owned),
        total_bytes,
        drm: false,
        unsupported_reason: None,
    })
}

pub fn detect_manifest(url: &str, body: &str) -> Result<MediaCandidate> {
    let lower = body.to_ascii_lowercase();
    let is_hls = url.contains(".m3u8") || body.contains("#EXTM3U");
    let is_dash = url.contains(".mpd") || lower.contains("<mpd");
    if !is_hls && !is_dash {
        return Err(EngineError::Message("not an HLS or DASH manifest".into()));
    }
    let drm = lower.contains("widevine")
        || lower.contains("playready")
        || lower.contains("com.apple.streamingkeydelivery")
        || lower.contains("cenc:pssh");
    if drm {
        return Err(EngineError::Message(
            "DRM-protected media is not supported".into(),
        ));
    }
    Ok(MediaCandidate {
        id: uuid::Uuid::new_v4().to_string(),
        url: url.to_owned(),
        title: None,
        kind: if is_hls {
            MediaKind::Hls
        } else {
            MediaKind::Dash
        },
        quality: None,
        mime_type: None,
        total_bytes: None,
        drm: false,
        unsupported_reason: None,
    })
}

pub async fn extract_with_ytdlp(url: &str) -> Result<Vec<MediaCandidate>> {
    let output = Command::new("yt-dlp")
        .args(["-j", "--no-playlist", url])
        .output()
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                EngineError::Message("yt-dlp is not installed or not available on PATH".into())
            } else {
                error.into()
            }
        })?;
    if !output.status.success() {
        return Err(EngineError::Message(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    let value: Value = serde_json::from_slice(&output.stdout)?;
    let mut candidates = Vec::new();
    if let Some(formats) = value.get("formats").and_then(Value::as_array) {
        for format in formats {
            let Some(url) = format.get("url").and_then(Value::as_str) else {
                continue;
            };
            let protocol = format.get("protocol").and_then(Value::as_str).unwrap_or("");
            let kind = if protocol.contains("m3u8") {
                MediaKind::Hls
            } else if protocol.contains("dash") {
                MediaKind::Dash
            } else {
                MediaKind::Progressive
            };
            candidates.push(MediaCandidate {
                id: uuid::Uuid::new_v4().to_string(),
                url: url.to_owned(),
                title: value
                    .get("title")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                kind,
                quality: format
                    .get("format_note")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                mime_type: format.get("ext").and_then(Value::as_str).map(str::to_owned),
                total_bytes: format.get("filesize").and_then(Value::as_u64),
                drm: false,
                unsupported_reason: None,
            });
        }
    }
    if candidates.is_empty() {
        return Err(EngineError::Message(
            "yt-dlp returned no downloadable formats".into(),
        ));
    }
    Ok(candidates)
}

pub async fn remux_with_ffmpeg(input: &Path, output: &Path) -> Result<()> {
    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-i")
        .arg(input)
        .args(["-c", "copy"])
        .arg(output)
        .status()
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                EngineError::Message("ffmpeg is not installed or not available on PATH".into())
            } else {
                error.into()
            }
        })?;
    if status.success() {
        Ok(())
    } else {
        Err(EngineError::Message(format!("ffmpeg exited with {status}")))
    }
}
