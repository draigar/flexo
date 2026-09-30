pub mod block_progress;
pub mod download;
pub mod file_version;
pub mod mirrors;
pub mod network;
pub mod plan;
pub mod scheduler;
pub mod settings;
pub mod snapshot;
pub mod torrent;
pub mod types;
pub mod video;

pub use download::manager::DownloadManager;
pub use types::*;

use futures::future::join_all;
use std::{collections::HashMap, net::IpAddr, path::PathBuf, sync::Arc};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("invalid URL: {0}")]
    Url(#[from] url::ParseError),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("worker failed: {0}")]
    Join(#[from] tokio::task::JoinError),
    #[error("download was cancelled")]
    Cancelled,
    #[error("there is no active download")]
    NoActiveDownload,
    #[error("{0}")]
    Message(String),
}

pub type Result<T> = std::result::Result<T, EngineError>;

#[derive(Clone)]
pub struct Engine {
    data_dir: PathBuf,
    manager: DownloadManager,
}

impl Engine {
    pub fn new(data_dir: PathBuf, on_update: Arc<dyn Fn(DownloadState) + Send + Sync>) -> Self {
        Self {
            manager: DownloadManager::new(data_dir.clone(), on_update),
            data_dir,
        }
    }

    pub async fn list_interfaces(&self) -> Result<Vec<NetworkInterfaceInfo>> {
        network::interfaces::list_active_interfaces()
    }

    pub async fn ping_interfaces(&self) -> Result<HashMap<String, Option<u64>>> {
        let interfaces = self.list_interfaces().await?;
        let futures = interfaces.into_iter().map(|interface| async move {
            let address: Option<IpAddr> = interface
                .addresses
                .iter()
                .find(|address| address.family == 4)
                .or_else(|| interface.addresses.first())
                .and_then(|address| address.address.parse().ok());
            let latency = network::latency::tcp_latency_ms(
                "https://one.one.one.one",
                address,
                Some(&interface.device),
            )
            .await
            .ok();
            (interface.id, latency)
        });
        Ok(join_all(futures).await.into_iter().collect())
    }

    pub async fn probe_url(&self, url: String) -> Result<ProbeResult> {
        download::probe::probe_url(&url, None).await
    }

    pub async fn start_download(&self, req: StartDownloadRequest) -> Result<String> {
        self.manager.start(req).await
    }

    pub async fn enqueue(&self, req: StartDownloadRequest) -> Result<String> {
        self.manager.enqueue(req).await
    }

    pub async fn pause(&self, id: String) -> Result<()> {
        self.manager.pause(&id).await
    }
    pub async fn resume(&self, id: String) -> Result<()> {
        self.manager.resume(&id).await
    }
    pub async fn cancel(&self, id: String) -> Result<()> {
        self.manager.cancel(Some(&id)).await
    }
    pub async fn remove(&self, id: String) -> Result<()> {
        self.manager.remove(&id).await
    }

    pub async fn get_current(&self) -> Option<DownloadState> {
        self.manager.get_current()
    }
    pub async fn get_active(&self) -> Vec<DownloadState> {
        self.manager.get_active()
    }
    pub async fn get_queue(&self) -> Vec<QueueItem> {
        self.manager.list_queue()
    }

    pub async fn resolve_media(&self, url: String) -> Result<Vec<MediaCandidate>> {
        let parsed = url::Url::parse(&url)?;
        let path = parsed.path().to_ascii_lowercase();
        if path.ends_with(".m3u8") || path.ends_with(".mpd") {
            let body = reqwest::get(&url).await?.error_for_status()?.text().await?;
            return Ok(vec![video::detect_manifest(&url, &body)?]);
        }
        match self.probe_url(url.clone()).await {
            Ok(probe) => Ok(vec![video::resolve_progressive(
                &probe.final_url,
                probe.content_type.as_deref(),
                probe.total_bytes,
            )?]),
            Err(_) => video::extract_with_ytdlp(&url).await,
        }
    }

    pub fn write_snapshot(&self) -> Result<()> {
        snapshot::write_snapshot_sync(
            &self.data_dir.join("widget-snapshot.json"),
            &WidgetSnapshot {
                current: self.manager.get_current(),
                queue: self.manager.list_queue(),
                written_at: now_ms(),
            },
        )
    }

    pub async fn load_settings(&self) -> Result<AppSettings> {
        settings::load(&self.data_dir.join("app-settings.json")).await
    }

    pub async fn save_settings(&self, settings: AppSettings) -> Result<()> {
        settings::save(&self.data_dir.join("app-settings.json"), &settings).await
    }

    pub fn device_binding_supported(&self) -> bool {
        cfg!(any(
            target_os = "linux",
            target_os = "macos",
            target_os = "windows"
        ))
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
