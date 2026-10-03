use crate::{
    network::{binding::client_for, interfaces::list_active_interfaces, latency::tcp_latency_ms},
    types::{DownloadState, DownloadStatus, NetworkInterfaceInfo, NetworkKind},
    Result,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::IpAddr,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::RwLock;

const PROBE_UPLOAD_BYTES: usize = 131_072;   // 128 KB test payload
const CLOUDFLARE_DOWN_URL: &str = "https://speed.cloudflare.com/__down?bytes=500000";
const CLOUDFLARE_UP_URL: &str = "https://speed.cloudflare.com/__up";
const CLOUDFLARE_BASE_URL: &str = "https://speed.cloudflare.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceSpeedInfo {
    pub interface_id: String,
    pub device: String,
    pub display_name: String,
    pub kind: NetworkKind,
    pub address: String,
    pub download_bytes_per_sec: u64,
    pub upload_bytes_per_sec: u64,
    pub latency_ms: Option<u64>,
    pub is_active_probe: bool,
    pub last_updated_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSpeedSnapshot {
    pub interfaces: Vec<InterfaceSpeedInfo>,
    pub total_download_bytes_per_sec: u64,
    pub total_upload_bytes_per_sec: u64,
    pub timestamp_ms: u64,
}

pub type SpeedUpdateCallback = Arc<dyn Fn(NetworkSpeedSnapshot) + Send + Sync>;

#[derive(Clone)]
pub struct SpeedMonitor {
    cached: Arc<RwLock<HashMap<String, InterfaceSpeedInfo>>>,
    on_update: Option<SpeedUpdateCallback>,
}

impl SpeedMonitor {
    pub fn new(on_update: Option<SpeedUpdateCallback>) -> Self {
        Self {
            cached: Arc::new(RwLock::new(HashMap::new())),
            on_update,
        }
    }

    pub async fn get_snapshot(&self) -> NetworkSpeedSnapshot {
        let cached = self.cached.read().await;
        let mut interfaces: Vec<InterfaceSpeedInfo> = cached.values().cloned().collect();
        interfaces.sort_by(|a, b| a.interface_id.cmp(&b.interface_id));
        let total_download = interfaces.iter().map(|i| i.download_bytes_per_sec).sum();
        let total_upload = interfaces.iter().map(|i| i.upload_bytes_per_sec).sum();
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        NetworkSpeedSnapshot {
            interfaces,
            total_download_bytes_per_sec: total_download,
            total_upload_bytes_per_sec: total_upload,
            timestamp_ms: now_ms,
        }
    }

    /// Measures an individual interface using real download traffic or active probe
    pub async fn measure_interface(
        &self,
        interface: &NetworkInterfaceInfo,
        active_download_bps: Option<u64>,
    ) -> InterfaceSpeedInfo {
        let preferred_address = interface
            .addresses
            .iter()
            .find(|a| a.family == 4)
            .or_else(|| interface.addresses.first())
            .map(|a| a.address.clone())
            .unwrap_or_default();

        let parsed_ip: Option<IpAddr> = preferred_address.parse().ok();
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        // Latency check
        let latency_ms = tcp_latency_ms(
            CLOUDFLARE_BASE_URL,
            parsed_ip,
            Some(&interface.device),
        )
        .await
        .ok();

        // If this interface is currently downloading actively (> 20 KB/s), use real throughput
        if let Some(real_dl) = active_download_bps {
            if real_dl > 20_000 {
                return InterfaceSpeedInfo {
                    interface_id: interface.id.clone(),
                    device: interface.device.clone(),
                    display_name: interface.display_name.clone(),
                    kind: interface.kind.clone(),
                    address: preferred_address,
                    download_bytes_per_sec: real_dl,
                    upload_bytes_per_sec: 0,
                    latency_ms,
                    is_active_probe: false,
                    last_updated_ms: now_ms,
                };
            }
        }

        // Active Probe via Public CDN (Cloudflare)
        let (dl_bps, ul_bps) = match parsed_ip {
            Some(ip) => match client_for(Some(ip)) {
                Ok(client) => {
                    // Download test
                    let dl = match tokio::time::timeout(
                        Duration::from_secs(6),
                        Self::probe_download(&client),
                    )
                    .await
                    {
                        Ok(Ok(bps)) => bps,
                        _ => 0,
                    };

                    // Upload test
                    let ul = match tokio::time::timeout(
                        Duration::from_secs(6),
                        Self::probe_upload(&client),
                    )
                    .await
                    {
                        Ok(Ok(bps)) => bps,
                        _ => 0,
                    };

                    (dl, ul)
                }
                Err(_) => (0, 0),
            },
            None => (0, 0),
        };

        InterfaceSpeedInfo {
            interface_id: interface.id.clone(),
            device: interface.device.clone(),
            display_name: interface.display_name.clone(),
            kind: interface.kind.clone(),
            address: preferred_address,
            download_bytes_per_sec: dl_bps,
            upload_bytes_per_sec: ul_bps,
            latency_ms,
            is_active_probe: true,
            last_updated_ms: now_ms,
        }
    }

    async fn probe_download(client: &reqwest::Client) -> Result<u64> {
        let started = Instant::now();
        let resp = client.get(CLOUDFLARE_DOWN_URL).send().await?;
        let bytes = resp.bytes().await?;
        let elapsed = started.elapsed().as_secs_f64();
        if elapsed > 0.05 && !bytes.is_empty() {
            Ok((bytes.len() as f64 / elapsed) as u64)
        } else {
            Ok(0)
        }
    }

    async fn probe_upload(client: &reqwest::Client) -> Result<u64> {
        let payload = vec![0u8; PROBE_UPLOAD_BYTES];
        let payload_len = payload.len();
        let started = Instant::now();
        let resp = client
            .post(CLOUDFLARE_UP_URL)
            .body(payload)
            .send()
            .await?;
        let _ = resp.status();
        let elapsed = started.elapsed().as_secs_f64();
        if elapsed > 0.05 {
            Ok((payload_len as f64 / elapsed) as u64)
        } else {
            Ok(0)
        }
    }

    /// Refresh all interfaces and emit snapshot
    pub async fn update_all(
        &self,
        active_downloads: &[DownloadState],
    ) -> NetworkSpeedSnapshot {
        let interfaces = match list_active_interfaces() {
            Ok(list) => list,
            Err(_) => Vec::new(),
        };

        // Calculate current real per-interface download speed from chunk states
        let mut real_speeds: HashMap<String, u64> = HashMap::new();
        for download in active_downloads {
            if download.status == DownloadStatus::Downloading {
                for chunk in &download.chunks {
                    *real_speeds.entry(chunk.interface_id.clone()).or_insert(0) +=
                        chunk.speed_bytes_per_sec;
                }
            }
        }

        let mut results = HashMap::new();
        for iface in interfaces {
            let real_speed = real_speeds.get(&iface.id).copied();
            let info = self.measure_interface(&iface, real_speed).await;
            results.insert(iface.id.clone(), info);
        }

        {
            let mut cached = self.cached.write().await;
            *cached = results;
        }

        let snapshot = self.get_snapshot().await;
        if let Some(cb) = &self.on_update {
            cb(snapshot.clone());
        }
        snapshot
    }

    /// Update passive speeds only (lightweight, zero network overhead during active downloads)
    pub async fn update_passive_from_chunks(
        &self,
        active_downloads: &[DownloadState],
    ) {
        let interfaces = match list_active_interfaces() {
            Ok(list) => list,
            Err(_) => return,
        };

        let mut real_speeds: HashMap<String, u64> = HashMap::new();
        for download in active_downloads {
            if download.status == DownloadStatus::Downloading {
                for chunk in &download.chunks {
                    *real_speeds.entry(chunk.interface_id.clone()).or_insert(0) +=
                        chunk.speed_bytes_per_sec;
                }
            }
        }

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let mut changed = false;
        {
            let mut cached = self.cached.write().await;
            for iface in interfaces {
                if let Some(&speed) = real_speeds.get(&iface.id) {
                    if speed > 0 {
                        let entry = cached.entry(iface.id.clone()).or_insert_with(|| {
                            InterfaceSpeedInfo {
                                interface_id: iface.id.clone(),
                                device: iface.device.clone(),
                                display_name: iface.display_name.clone(),
                                kind: iface.kind.clone(),
                                address: iface.addresses.first().map(|a| a.address.clone()).unwrap_or_default(),
                                download_bytes_per_sec: speed,
                                upload_bytes_per_sec: 0,
                                latency_ms: None,
                                is_active_probe: false,
                                last_updated_ms: now_ms,
                            }
                        });
                        entry.download_bytes_per_sec = speed;
                        entry.is_active_probe = false;
                        entry.last_updated_ms = now_ms;
                        changed = true;
                    }
                }
            }
        }

        if changed {
            let snapshot = self.get_snapshot().await;
            if let Some(cb) = &self.on_update {
                cb(snapshot);
            }
        }
    }
}
