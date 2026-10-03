use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NetworkKind {
    Wifi,
    Usb,
    Ethernet,
    Bridge,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAddress {
    pub address: String,
    pub family: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub netmask: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subnet: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceInfo {
    pub id: String,
    pub device: String,
    pub display_name: String,
    pub addresses: Vec<NetworkAddress>,
    pub kind: NetworkKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mac: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub requested_url: String,
    pub final_url: String,
    pub supports_ranges: bool,
    pub total_bytes: Option<u64>,
    pub suggested_file_name: String,
    pub content_type: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Downloading,
    Assembling,
    Paused,
    Completed,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BlockStatus {
    Pending,
    Downloading,
    Completed,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChunkStatus {
    Pending,
    Downloading,
    Retrying,
    Paused,
    Completed,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockState {
    pub index: usize,
    pub range_start: u64,
    pub range_end: Option<u64>,
    pub status: BlockStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interface_id: Option<String>,
    pub bytes_downloaded: u64,
    #[serde(default)]
    pub bytes_by_interface: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkState {
    pub id: usize,
    pub interface_id: String,
    pub interface_label: String,
    pub interface_kind: NetworkKind,
    pub range_start: u64,
    pub range_end: Option<u64>,
    pub bytes_downloaded: u64,
    pub speed_bytes_per_sec: u64,
    pub status: ChunkStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub retry_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_block_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hedge: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadState {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub destination_path: PathBuf,
    pub total_bytes: u64,
    pub bytes_downloaded: u64,
    pub speed_bytes_per_sec: u64,
    pub status: DownloadStatus,
    pub chunks: Vec<ChunkState>,
    pub blocks: Vec<BlockState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_blocks: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub started_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paused_at: Option<u64>,
    #[serde(default)]
    pub total_paused_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assembled_bytes: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPreference {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_source: Option<ThemeSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissed_update_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streams_per_network: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_dir: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_preferences: Option<HashMap<String, NetworkPreference>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_preset: Option<SegmentPreset>,
    /// When set, a captured browser or deep link starts immediately. Missing means on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_download: Option<bool>,
    /// When set, a copied http(s) or magnet link is offered in the link field. Missing means on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watch_clipboard: Option<bool>,
    /// Maximum concurrent active downloads (defaults to 6, up to 100).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_concurrent_downloads: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeSource {
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadRequest {
    pub url: String,
    pub destination_dir: PathBuf,
    pub suggested_file_name: String,
    pub total_bytes: u64,
    pub supports_ranges: bool,
    pub interface_ids: Vec<String>,
    pub chunk_count: usize,
    pub connections_per_network: Option<usize>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    #[serde(default)]
    pub mirror_urls: Vec<String>,
    pub max_block_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub status: QueueItemStatus,
    pub added_at: u64,
    pub request: StartDownloadRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum QueueItemStatus {
    Waiting,
    Ready,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Progressive,
    Hls,
    Dash,
    Page,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCandidate {
    pub id: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub kind: MediaKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    pub total_bytes: Option<u64>,
    pub drm: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSnapshot {
    pub current: Option<DownloadState>,
    pub queue: Vec<QueueItem>,
    pub written_at: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SegmentPreset {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "8")]
    Mb8,
    #[serde(rename = "16")]
    Mb16,
    #[serde(rename = "32")]
    Mb32,
    #[serde(rename = "64")]
    Mb64,
}

impl SegmentPreset {
    pub fn bytes(self) -> Option<u64> {
        match self {
            Self::Auto => None,
            Self::Mb8 => Some(8 * 1024 * 1024),
            Self::Mb16 => Some(16 * 1024 * 1024),
            Self::Mb32 => Some(32 * 1024 * 1024),
            Self::Mb64 => Some(64 * 1024 * 1024),
        }
    }
}
