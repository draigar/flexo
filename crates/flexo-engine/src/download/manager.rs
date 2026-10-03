use crate::{
    download::{chunk::download_range, part_files, probe::probe_url},
    plan::{plan_download, PlanRequest},
    types::*,
    EngineError, Result,
};
use parking_lot::{Mutex, RwLock};
use std::{
    collections::{HashMap, VecDeque},
    net::IpAddr,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::{fs, sync::broadcast};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

type UpdateCallback = Arc<dyn Fn(DownloadState) + Send + Sync>;

pub const DEFAULT_MAX_CONCURRENT: usize = 6;
const SPEED_WINDOW_MS: u64 = 3_000;
const PROGRESS_THROTTLE_MS: u64 = 200;
const SPEED_TICK_MS: u64 = 500;

#[derive(Default)]
struct SpeedRuntime {
    /// Cumulative bytes each stream has received this job (for the rolling window).
    received_by_stream: HashMap<usize, u64>,
    /// (cumulative_bytes, time_ms) samples per stream.
    samples_by_stream: HashMap<usize, Vec<(u64, u64)>>,
    last_emit_at: u64,
}

struct Inner {
    data_dir: PathBuf,
    active: RwLock<HashMap<String, DownloadState>>,
    queue: Mutex<VecDeque<QueueItem>>,
    requests: Mutex<HashMap<String, StartDownloadRequest>>,
    cancels: Mutex<HashMap<String, CancellationToken>>,
    speeds: Mutex<HashMap<String, SpeedRuntime>>,
    max_concurrent: Mutex<usize>,
    updates: broadcast::Sender<DownloadState>,
    on_update: UpdateCallback,
}

#[derive(Clone)]
pub struct DownloadManager {
    inner: Arc<Inner>,
}

impl DownloadManager {
    pub fn new(data_dir: PathBuf, on_update: UpdateCallback) -> Self {
        let (updates, _) = broadcast::channel(128);
        Self {
            inner: Arc::new(Inner {
                data_dir,
                active: RwLock::new(HashMap::new()),
                queue: Mutex::new(VecDeque::new()),
                requests: Mutex::new(HashMap::new()),
                cancels: Mutex::new(HashMap::new()),
                speeds: Mutex::new(HashMap::new()),
                max_concurrent: Mutex::new(DEFAULT_MAX_CONCURRENT),
                updates,
                on_update,
            }),
        }
    }

    pub fn set_max_concurrent(&self, limit: usize) {
        *self.inner.max_concurrent.lock() = limit.clamp(1, 100);
        self.pump_queue();
    }

    pub fn get_max_concurrent(&self) -> usize {
        *self.inner.max_concurrent.lock()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<DownloadState> {
        self.inner.updates.subscribe()
    }

    pub async fn start(&self, req: StartDownloadRequest) -> Result<String> {
        self.submit(req, false).await
    }

    pub async fn enqueue(&self, req: StartDownloadRequest) -> Result<String> {
        self.submit(req, true).await
    }

    async fn submit(&self, req: StartDownloadRequest, force_queue: bool) -> Result<String> {
        UrlCheck::validate(&req.url)?;
        let id = Uuid::new_v4().to_string();
        self.inner.requests.lock().insert(id.clone(), req.clone());

        let limit = *self.inner.max_concurrent.lock();
        let downloading_count = {
            let active = self.inner.active.read();
            active
                .values()
                .filter(|s| {
                    matches!(
                        s.status,
                        DownloadStatus::Downloading | DownloadStatus::Assembling
                    )
                })
                .count()
        };

        if force_queue || downloading_count >= limit {
            self.inner.queue.lock().push_back(QueueItem {
                id: id.clone(),
                url: req.url.clone(),
                file_name: req.suggested_file_name.clone(),
                status: QueueItemStatus::Waiting,
                added_at: now_ms(),
                request: req,
            });
            self.persist_manifest().await?;
            self.pump_queue();
        } else {
            self.launch(id.clone(), req, None);
        }
        Ok(id)
    }

    fn launch(&self, id: String, req: StartDownloadRequest, destination: Option<PathBuf>) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            // Outer retry loop: on transient errors (429, 404, 5xx, network drops)
            // silently wait and retry without ever showing the "Download Failed" dialog.
            // Only terminal errors (Cancelled, Paused, or exhausted retries) show the dialog.
            const MAX_JOB_RETRIES: u32 = 10;
            let mut job_attempt = 0u32;
            let mut dest = destination;
            loop {
                match run_job(inner.clone(), id.clone(), req.clone(), dest.clone()).await {
                    Ok(()) => break, // success – nothing more to do
                    Err(error) => {
                        // Check if the download was intentionally paused/cancelled
                        let intentional_stop = inner.active.read().get(&id).is_some_and(|s| {
                            matches!(s.status, DownloadStatus::Paused | DownloadStatus::Cancelled)
                        });
                        if intentional_stop {
                            break;
                        }

                        // Check if this is a transient / retryable error
                        let is_transient = is_transient_error(&error);
                        if is_transient && job_attempt < MAX_JOB_RETRIES {
                            job_attempt += 1;
                            // Calculate back-off: 2s, 4s, 8s … capped at 30s
                            let backoff_secs = (2u64 << (job_attempt - 1).min(4)).min(30);

                            // Keep the status as Downloading (not Error) during silent retry
                            {
                                let mut active = inner.active.write();
                                if let Some(state) = active.get_mut(&id) {
                                    if !matches!(
                                        state.status,
                                        DownloadStatus::Paused | DownloadStatus::Cancelled
                                    ) {
                                        state.status = DownloadStatus::Downloading;
                                        state.error = None;
                                        emit(&inner, state.clone());
                                    }
                                }
                            }

                            // Preserve the destination so part files are reused
                            if dest.is_none() {
                                dest = inner
                                    .active
                                    .read()
                                    .get(&id)
                                    .map(|s| s.destination_path.clone());
                            }

                            let cancel = inner.cancels.lock().get(&id).cloned();
                            if let Some(cancel) = cancel {
                                tokio::select! {
                                    _ = cancel.cancelled() => break,
                                    _ = tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)) => {}
                                }
                            } else {
                                tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)).await;
                            }
                            continue; // retry the job
                        }

                        // Non-retryable error or retries exhausted – show the dialog
                        let mut active = inner.active.write();
                        if let Some(current) = active.get_mut(&id) {
                            if !matches!(
                                current.status,
                                DownloadStatus::Paused | DownloadStatus::Cancelled
                            ) {
                                current.status = DownloadStatus::Error;
                                current.error = Some(error.to_string());
                            }
                            emit(&inner, current.clone());
                        }
                        break;
                    }
                }
            }
            inner.cancels.lock().remove(&id);
            inner.speeds.lock().remove(&id);
            let manager = DownloadManager { inner };
            manager.pump_queue();
        });
    }

    pub fn pump_queue(&self) {
        let limit = *self.inner.max_concurrent.lock();
        let downloading_count = {
            let active = self.inner.active.read();
            active
                .values()
                .filter(|s| {
                    matches!(
                        s.status,
                        DownloadStatus::Downloading | DownloadStatus::Assembling
                    )
                })
                .count()
        };
        if downloading_count >= limit {
            return;
        }
        let slots = limit.saturating_sub(downloading_count);
        let mut to_launch = Vec::new();
        {
            let mut queue = self.inner.queue.lock();
            for _ in 0..slots {
                if let Some(next) = queue.pop_front() {
                    to_launch.push((next.id, next.request));
                } else {
                    break;
                }
            }
        }
        if !to_launch.is_empty() {
            let inner = self.inner.clone();
            tokio::spawn(async move {
                let _ = DownloadManager { inner }.persist_manifest().await;
            });
            for (id, req) in to_launch {
                self.launch(id, req, None);
            }
        }
    }

    pub fn start_next(&self) {
        self.pump_queue();
    }

    pub async fn pause(&self, id: &str) -> Result<()> {
        {
            let mut active = self.inner.active.write();
            let state = active.get_mut(id).ok_or(EngineError::NoActiveDownload)?;
            if state.status != DownloadStatus::Downloading {
                return Ok(());
            }
            if let Some(cancel) = self.inner.cancels.lock().get(id) {
                cancel.cancel();
            }
            state.status = DownloadStatus::Paused;
            state.paused_at = Some(now_ms());
            state.speed_bytes_per_sec = 0;
            for chunk in &mut state.chunks {
                chunk.status = ChunkStatus::Paused;
                chunk.current_block_index = None;
                chunk.speed_bytes_per_sec = 0;
            }
            if let Some(speed) = self.inner.speeds.lock().get_mut(id) {
                speed.samples_by_stream.clear();
            }
            emit(&self.inner, state.clone());
        }
        self.persist_manifest().await?;
        self.pump_queue();
        Ok(())
    }

    pub async fn resume(&self, id: &str) -> Result<()> {
        let (id_str, destination) = {
            let mut active = self.inner.active.write();
            let state = active.get_mut(id).ok_or(EngineError::NoActiveDownload)?;
            if !matches!(state.status, DownloadStatus::Paused | DownloadStatus::Error) {
                return Ok(());
            }
            state.status = DownloadStatus::Downloading;
            state.error = None;
            emit(&self.inner, state.clone());
            (state.id.clone(), state.destination_path.clone())
        };
        let req = self
            .inner
            .requests
            .lock()
            .get(&id_str)
            .cloned()
            .ok_or_else(|| EngineError::Message("download request is unavailable".into()))?;
        self.launch(id_str, req, Some(destination));
        Ok(())
    }

    pub async fn cancel(&self, id: Option<&str>) -> Result<()> {
        if let Some(id) = id {
            if let Some(cancel) = self.inner.cancels.lock().get(id) {
                cancel.cancel();
            }
            if let Some(state) = self.inner.active.write().get_mut(id) {
                state.status = DownloadStatus::Cancelled;
                emit(&self.inner, state.clone());
            }
            self.inner.queue.lock().retain(|item| item.id != id);
            self.persist_manifest().await?;
            self.pump_queue();
        } else {
            for cancel in self.inner.cancels.lock().values() {
                cancel.cancel();
            }
            for state in self.inner.active.write().values_mut() {
                state.status = DownloadStatus::Cancelled;
                emit(&self.inner, state.clone());
            }
            self.inner.queue.lock().clear();
            self.persist_manifest().await?;
            self.pump_queue();
        }
        Ok(())
    }

    pub async fn remove(&self, id: &str) -> Result<()> {
        self.cancel(Some(id)).await?;
        let removed = self.inner.active.write().remove(id);
        self.inner.requests.lock().remove(id);
        self.inner.cancels.lock().remove(id);
        self.inner.speeds.lock().remove(id);
        if let Some(state) = removed {
            let _ = fs::remove_file(state.destination_path).await;
            let _ = fs::remove_dir_all(self.inner.data_dir.join("parts").join(id)).await;
        }
        self.persist_manifest().await?;
        self.pump_queue();
        Ok(())
    }

    pub fn get_current(&self) -> Option<DownloadState> {
        let active = self.inner.active.read();
        active
            .values()
            .find(|s| s.status == DownloadStatus::Downloading)
            .or_else(|| active.values().next())
            .cloned()
    }

    pub fn get_active(&self) -> Vec<DownloadState> {
        self.inner
            .active
            .read()
            .values()
            .filter(|s| {
                s.status != DownloadStatus::Completed && s.status != DownloadStatus::Cancelled
            })
            .cloned()
            .collect()
    }

    pub fn list_queue(&self) -> Vec<QueueItem> {
        self.inner.queue.lock().iter().cloned().collect()
    }

    pub async fn persist_manifest(&self) -> Result<()> {
        fs::create_dir_all(&self.inner.data_dir).await?;
        let payload = serde_json::to_vec_pretty(&self.list_queue())?;
        let temp = self.inner.data_dir.join(format!("queue.json.tmp.{}", Uuid::new_v4()));
        fs::write(&temp, payload).await?;
        fs::rename(temp, self.inner.data_dir.join("queue.json")).await?;
        Ok(())
    }
}

async fn run_job(
    inner: Arc<Inner>,
    id: String,
    req: StartDownloadRequest,
    existing_destination: Option<PathBuf>,
) -> Result<()> {
    if req.url.starts_with("magnet:") || req.url.ends_with(".torrent") {
        return run_torrent_job(inner, id, req, existing_destination).await;
    }

    // Check if we have an existing state for this download (resume scenario)
    let existing_state = inner.active.read().get(&id).cloned();

    let (file_name, destination, total_bytes, plan, mut blocks, chunks) = match existing_state {
        Some(ref prev) if !prev.blocks.is_empty() => {
            // RESUME PATH: Preserve identical plan and block ranges so part files align 100%!
            let file_name = prev.file_name.clone();
            let destination = match existing_destination {
                Some(p) => p,
                None => prev.destination_path.clone(),
            };
            let total_bytes = prev.total_bytes;
            let block_size = prev.block_size_bytes.unwrap_or(8 * 1024 * 1024);
            let block_count = prev.total_blocks.unwrap_or(prev.blocks.len());
            let stream_networks: Vec<usize> = if prev.chunks.is_empty() {
                vec![0]
            } else {
                prev.chunks.iter().map(|c| c.id % 1.max(prev.chunks.len())).collect()
            };
            let plan = crate::plan::DownloadPlan {
                block_size_bytes: block_size,
                block_count,
                stream_networks,
            };
            (file_name, destination, total_bytes, plan, prev.blocks.clone(), prev.chunks.clone())
        }
        _ => {
            // FRESH START PATH: Probe and plan
            let probe = probe_url(&req.url, None).await?;
            let file_name = sanitize_file_name(if req.suggested_file_name.is_empty() {
                &probe.suggested_file_name
            } else {
                &req.suggested_file_name
            });
            let directory = req.destination_dir.clone();
            let destination = match existing_destination {
                Some(path) => path,
                None => reserve_destination(&directory, &file_name).await?,
            };
            let interface_addresses: Vec<(String, String, NetworkKind, Option<IpAddr>)> =
                crate::network::interfaces::list_active_interfaces()?
                    .into_iter()
                    .filter(|interface| {
                        req.interface_ids.is_empty() || req.interface_ids.contains(&interface.id)
                    })
                    .filter_map(|interface| {
                        let address = interface
                            .addresses
                            .iter()
                            .find(|address| address.family == 4)
                            .or_else(|| interface.addresses.first())
                            .and_then(|address| address.address.parse().ok())?;
                        Some((
                            interface.id,
                            interface.display_name,
                            interface.kind,
                            Some(address),
                        ))
                    })
                    .collect();
            let interfaces = if interface_addresses.is_empty() {
                vec![("default".into(), "Default".into(), NetworkKind::Other, None)]
            } else {
                interface_addresses
            };
            let total_bytes = probe.total_bytes.unwrap_or(req.total_bytes);
            let plan = plan_download(PlanRequest {
                total_bytes,
                splittable: probe.supports_ranges && req.supports_ranges,
                network_count: interfaces.len(),
                streams_per_network: req
                    .connections_per_network
                    .unwrap_or_else(|| req.chunk_count.div_ceil(interfaces.len()).max(1)),
                max_block_bytes: req.max_block_bytes,
            });
            let blocks: Vec<_> = (0..plan.block_count)
                .map(|index| {
                    let start = index as u64 * plan.block_size_bytes;
                    BlockState {
                        index,
                        range_start: start,
                        range_end: Some(
                            (start + plan.block_size_bytes.saturating_sub(1)).min(
                                total_bytes.saturating_sub(1),
                            ),
                        ),
                        status: BlockStatus::Pending,
                        interface_id: None,
                        bytes_downloaded: 0,
                        bytes_by_interface: HashMap::new(),
                    }
                })
                .collect();
            let chunks: Vec<_> = plan
                .stream_networks
                .iter()
                .enumerate()
                .map(|(id, network)| {
                    let net_idx = *network % interfaces.len();
                    ChunkState {
                        id,
                        interface_id: interfaces[net_idx].0.clone(),
                        interface_label: interfaces[net_idx].1.clone(),
                        interface_kind: interfaces[net_idx].2.clone(),
                        range_start: 0,
                        range_end: None,
                        bytes_downloaded: 0,
                        error: None,
                        retry_count: 0,
                        current_block_index: None,
                        hedge: None,
                        status: ChunkStatus::Pending,
                        speed_bytes_per_sec: 0,
                    }
                })
                .collect();
            (file_name, destination, total_bytes, plan, blocks, chunks)
        }
    };

    let interface_addresses: Vec<(String, String, NetworkKind, Option<IpAddr>)> =
        crate::network::interfaces::list_active_interfaces()?
            .into_iter()
            .filter(|interface| {
                req.interface_ids.is_empty() || req.interface_ids.contains(&interface.id)
            })
            .filter_map(|interface| {
                let address = interface
                    .addresses
                    .iter()
                    .find(|address| address.family == 4)
                    .or_else(|| interface.addresses.first())
                    .and_then(|address| address.address.parse().ok())?;
                Some((
                    interface.id,
                    interface.display_name,
                    interface.kind,
                    Some(address),
                ))
            })
            .collect();
    let interfaces = if interface_addresses.is_empty() {
        vec![("default".into(), "Default".into(), NetworkKind::Other, None)]
    } else {
        interface_addresses
    };

    let cancel = CancellationToken::new();
    inner.cancels.lock().insert(id.clone(), cancel.clone());
    inner.speeds.lock().insert(id.clone(), SpeedRuntime::default());

    let parts_dir = inner.data_dir.join("parts").join(&id);
    fs::create_dir_all(&parts_dir).await?;

    // Check existing part files on disk to resume from the exact last byte saved!
    let mut initial_downloaded = 0_u64;
    let mut pending_indices = VecDeque::new();
    for (i, block) in blocks.iter_mut().enumerate() {
        let path = part_files::part_file(&parts_dir, &id, i);
        let expected_len = block
            .range_end
            .unwrap_or(block.range_start)
            .saturating_sub(block.range_start)
            + 1;
        if let Ok(meta) = fs::metadata(&path).await {
            let disk_len = meta.len();
            if disk_len >= expected_len {
                block.status = BlockStatus::Completed;
                block.bytes_downloaded = expected_len;
                initial_downloaded += expected_len;
                continue;
            } else if disk_len > 0 {
                // Partial block preserved!
                block.status = BlockStatus::Pending;
                block.bytes_downloaded = disk_len;
                initial_downloaded += disk_len;
                pending_indices.push_back(i);
                continue;
            }
        }
        block.status = BlockStatus::Pending;
        block.bytes_downloaded = 0;
        pending_indices.push_back(i);
    }
    let pending_queue = Arc::new(Mutex::new(pending_indices));

    let started_at = existing_state.as_ref().map(|s| s.started_at).unwrap_or_else(now_ms);
    let mut total_paused_ms = existing_state.as_ref().map(|s| s.total_paused_ms).unwrap_or(0);
    if let Some(prev) = &existing_state {
        if let Some(paused_at) = prev.paused_at {
            total_paused_ms += now_ms().saturating_sub(paused_at);
        }
    }

    let state = DownloadState {
        id: id.clone(),
        url: req.url.clone(),
        file_name,
        destination_path: destination.clone(),
        speed_bytes_per_sec: 0,
        status: DownloadStatus::Downloading,
        total_bytes,
        bytes_downloaded: initial_downloaded,
        total_blocks: Some(plan.block_count),
        block_size_bytes: Some(plan.block_size_bytes),
        blocks,
        chunks,
        error: None,
        started_at,
        paused_at: None,
        total_paused_ms,
        completed_at: None,
        assembled_bytes: None,
    };
    inner.active.write().insert(id.clone(), state.clone());
    emit(&inner, state);

    // Refresh speeds even when a connection goes quiet, so TOTAL SPEED / the chart decay to 0.
    {
        let inner = inner.clone();
        let cancel = cancel.clone();
        let id = id.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = tokio::time::sleep(std::time::Duration::from_millis(SPEED_TICK_MS)) => {
                        let snapshot = {
                            let mut active = inner.active.write();
                            let Some(state) = active.get_mut(&id).filter(|state| {
                                state.status == DownloadStatus::Downloading
                            }) else {
                                break;
                            };
                            let previous = state.speed_bytes_per_sec;
                            refresh_speeds(&inner, &id, state);
                            if state.speed_bytes_per_sec != previous {
                                Some(state.clone())
                            } else {
                                None
                            }
                        };
                        if let Some(state) = snapshot {
                            emit_throttled(&inner, &id, state, true);
                        }
                    }
                }
            }
        });
    }

    let mut workers = Vec::new();
    for (stream_id, network_index) in plan.stream_networks.iter().copied().enumerate() {
        let inner = inner.clone();
        let pending_queue = pending_queue.clone();
        let cancel = cancel.clone();
        let req = req.clone();
        let id = id.clone();
        let parts_dir = parts_dir.clone();
        let net_idx = network_index % interfaces.len();
        let (_, _, _, local_address) = interfaces[net_idx].clone();
        workers.push(tokio::spawn(async move {
            loop {
                if cancel.is_cancelled() {
                    return Err(EngineError::Cancelled);
                }
                let index = {
                    let mut queue = pending_queue.lock();
                    match queue.pop_front() {
                        Some(i) => i,
                        None => break,
                    }
                };
                let (start, end, interface_id, initial_block_bytes) = {
                    let mut active = inner.active.write();
                    let state = active.get_mut(&id).ok_or(EngineError::NoActiveDownload)?;
                    let Some(block) = state.blocks.get_mut(index) else {
                        break;
                    };
                    block.status = BlockStatus::Downloading;
                    block.interface_id = Some(state.chunks[stream_id].interface_id.clone());
                    state.chunks[stream_id].status = ChunkStatus::Downloading;
                    state.chunks[stream_id].current_block_index = Some(index);
                    state.chunks[stream_id].range_start = block.range_start;
                    state.chunks[stream_id].range_end = block.range_end;
                    (
                        block.range_start,
                        block.range_end.unwrap(),
                        state.chunks[stream_id].interface_id.clone(),
                        block.bytes_downloaded,
                    )
                };
                let source_index = index % (req.mirror_urls.len() + 1);
                let source = if source_index == 0 {
                    &req.url
                } else {
                    &req.mirror_urls[source_index - 1]
                };
                let path = part_files::part_file(&parts_dir, &id, index);
                let mut last_position = initial_block_bytes;
                let id_for_progress = id.clone();
                download_range(
                    source,
                    start,
                    end,
                    &path,
                    local_address,
                    cancel.clone(),
                    |position| {
                        let delta = position.saturating_sub(last_position);
                        last_position = position;
                        if delta == 0 {
                            return;
                        }
                        let snapshot = {
                            let mut active = inner.active.write();
                            let Some(state) = active.get_mut(&id_for_progress) else {
                                return;
                            };
                            let old = state.blocks[index].bytes_downloaded;
                            state.blocks[index].bytes_downloaded = position;
                            *state.blocks[index]
                                .bytes_by_interface
                                .entry(interface_id.clone())
                                .or_default() += position.saturating_sub(old);
                            state.bytes_downloaded += position.saturating_sub(old);
                            state.chunks[stream_id].bytes_downloaded += delta;
                            {
                                let mut speeds = inner.speeds.lock();
                                let speed = speeds.entry(id_for_progress.clone()).or_default();
                                let received = {
                                    let received = speed
                                        .received_by_stream
                                        .entry(stream_id)
                                        .or_insert(0);
                                    *received += delta;
                                    *received
                                };
                                let now = now_ms();
                                let samples = speed.samples_by_stream.entry(stream_id).or_default();
                                state.chunks[stream_id].speed_bytes_per_sec =
                                    push_speed_sample(samples, received, now);
                            }
                            refresh_total_speed(state);
                            Some(state.clone())
                        };
                        if let Some(state) = snapshot {
                            emit_throttled(&inner, &id_for_progress, state, false);
                        }
                    },
                )
                .await?;
                let mut active = inner.active.write();
                if let Some(state) = active.get_mut(&id) {
                    state.blocks[index].status = BlockStatus::Completed;
                    state.chunks[stream_id].status = ChunkStatus::Pending;
                    state.chunks[stream_id].current_block_index = None;
                }
            }
            Ok::<(), EngineError>(())
        }));
    }
    for worker in workers {
        match worker.await {
            Ok(Ok(())) => {}
            Ok(Err(EngineError::Cancelled))
                if inner.active.read().get(&id).is_some_and(|s| {
                    matches!(s.status, DownloadStatus::Paused | DownloadStatus::Cancelled)
                }) =>
            {
                return Ok(())
            }
            Ok(Err(error)) => return Err(error),
            Err(error) => return Err(error.into()),
        }
    }
    let block_count = {
        let active = inner.active.read();
        active.get(&id).map(|s| s.blocks.len()).unwrap_or(plan.block_count)
    };
    let parts: Vec<_> = (0..block_count)
        .map(|index| part_files::part_file(&parts_dir, &id, index))
        .collect();
    {
        let mut active = inner.active.write();
        if let Some(state) = active.get_mut(&id) {
            state.status = DownloadStatus::Assembling;
            state.assembled_bytes = Some(0);
            state.speed_bytes_per_sec = 0;
            for chunk in &mut state.chunks {
                chunk.speed_bytes_per_sec = 0;
            }
            emit(&inner, state.clone());
        }
    }

    let inner_for_assemble = inner.clone();
    let id_for_assemble = id.clone();
    let mut last_assemble_emit = 0_u64;
    part_files::assemble_with_progress(&parts, &destination, move |assembled| {
        let now = now_ms();
        if now.saturating_sub(last_assemble_emit) >= 200 {
            last_assemble_emit = now;
            let mut active = inner_for_assemble.active.write();
            if let Some(state) = active.get_mut(&id_for_assemble) {
                state.assembled_bytes = Some(assembled);
                emit(&inner_for_assemble, state.clone());
            }
        }
    })
    .await?;

    {
        let mut active = inner.active.write();
        if let Some(state) = active.get_mut(&id) {
            state.status = DownloadStatus::Completed;
            state.bytes_downloaded = state.total_bytes;
            state.assembled_bytes = Some(state.total_bytes);
            state.completed_at = Some(now_ms());
            for chunk in &mut state.chunks {
                chunk.status = ChunkStatus::Completed;
            }
            emit(&inner, state.clone());
        }
    }
    let _ = fs::remove_dir_all(parts_dir).await;
    Ok(())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Returns true if the error is transient and the job should be silently retried.
/// Returns false for permanent errors like user cancellation or access-denied (403).
fn is_transient_error(error: &EngineError) -> bool {
    match error {
        // User-initiated stops are never retried
        EngineError::Cancelled => false,
        EngineError::NoActiveDownload => false,
        // HTTP errors – check the status code
        EngineError::Http(e) => {
            if let Some(status) = e.status() {
                // 429 Too Many Requests, 5xx server errors -> retryable
                // 404 Not Found (expired token) -> retryable
                // 403 Forbidden, 401 Unauthorized -> NOT retryable
                status == reqwest::StatusCode::TOO_MANY_REQUESTS
                    || status == reqwest::StatusCode::NOT_FOUND
                    || status.is_server_error()
            } else {
                // No status code -> network-level error (connection reset, timeout) -> retryable
                true
            }
        }
        // I/O errors can be transient (disk temp unavail, broken pipe)
        EngineError::Io(_) => true,
        // Message-based errors: check for known transient patterns
        EngineError::Message(msg) => {
            let m = msg.to_lowercase();
            m.contains("404")
                || m.contains("429")
                || m.contains("rate limit")
                || m.contains("too many requests")
                || m.contains("server error")
                || m.contains("timed out")
                || m.contains("connection")
                || m.contains("stream")
                || m.contains("token may have expired")
        }
        // Everything else (JSON parse, URL parse, JoinError) -> not retryable
        _ => false,
    }
}

fn push_speed_sample(samples: &mut Vec<(u64, u64)>, bytes: u64, time: u64) -> u64 {
    if samples
        .last()
        .is_some_and(|(_, last_time)| time.saturating_sub(*last_time) > SPEED_WINDOW_MS)
    {
        samples.clear();
    }
    samples.push((bytes, time));
    calculate_current_speed(samples, time)
}

fn calculate_current_speed(samples: &mut Vec<(u64, u64)>, time: u64) -> u64 {
    let Some(&(latest_bytes, latest_time)) = samples.last() else {
        return 0;
    };
    if time.saturating_sub(latest_time) > SPEED_WINDOW_MS {
        return 0;
    }
    let cutoff = time.saturating_sub(SPEED_WINDOW_MS);
    while samples.len() > 2 && samples.get(1).is_some_and(|(_, t)| *t <= cutoff) {
        samples.remove(0);
    }
    let Some(&(oldest_bytes, oldest_time)) = samples.first() else {
        return 0;
    };
    let delta_seconds = ((time.saturating_sub(oldest_time)) as f64 / 1000.0).max(1.0);
    ((latest_bytes.saturating_sub(oldest_bytes)) as f64 / delta_seconds).round() as u64
}

fn refresh_speeds(inner: &Inner, id: &str, state: &mut DownloadState) {
    let now = now_ms();
    let mut speeds = inner.speeds.lock();
    let speed = speeds.entry(id.to_string()).or_default();
    let mut total = 0_u64;
    for (stream_id, chunk) in state.chunks.iter_mut().enumerate() {
        if chunk.status == ChunkStatus::Downloading {
            if let Some(samples) = speed.samples_by_stream.get_mut(&stream_id) {
                chunk.speed_bytes_per_sec = calculate_current_speed(samples, now);
            }
        } else if speed
            .samples_by_stream
            .get(&stream_id)
            .and_then(|samples| samples.last())
            .is_none_or(|(_, t)| now.saturating_sub(*t) > SPEED_WINDOW_MS)
        {
            chunk.speed_bytes_per_sec = 0;
        }
        total = total.saturating_add(chunk.speed_bytes_per_sec);
    }
    state.speed_bytes_per_sec = total;
}

fn refresh_total_speed(state: &mut DownloadState) {
    state.speed_bytes_per_sec = state
        .chunks
        .iter()
        .map(|chunk| chunk.speed_bytes_per_sec)
        .sum();
}

fn emit_throttled(inner: &Inner, id: &str, state: DownloadState, force: bool) {
    let now = now_ms();
    {
        let mut speeds = inner.speeds.lock();
        let speed = speeds.entry(id.to_string()).or_default();
        if !force && now.saturating_sub(speed.last_emit_at) < PROGRESS_THROTTLE_MS {
            return;
        }
        speed.last_emit_at = now;
    }
    emit(inner, state);
}

fn emit(inner: &Inner, state: DownloadState) {
    let _ = inner.updates.send(state.clone());
    (inner.on_update)(state);
}

pub fn sanitize_file_name(name: &str) -> String {
    // Characters illegal on both Unix and Windows
    let safe: String = name
        .chars()
        .map(|ch| {
            match ch {
                // Illegal on all platforms
                '/' | '\\' => '_',
                // Control characters
                c if c.is_control() => '_',
                // Illegal on Windows (NTFS / FAT)
                ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
                c => c,
            }
        })
        .collect();

    // Trim leading / trailing spaces and trailing dots (Windows rejects these)
    let safe = safe.trim_matches(|c| c == ' ' || c == '.').to_string();

    if safe.is_empty() || safe.chars().all(|ch| ch == '_') {
        return "download".into();
    }

    // Reject Windows reserved device names (case-insensitive).
    // CON, PRN, AUX, NUL, COM1-COM9, LPT1-LPT9 — with or without an extension.
    let stem = safe.split('.').next().unwrap_or(&safe).to_ascii_uppercase();
    let is_reserved = matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL"
            | "COM1" | "COM2" | "COM3" | "COM4" | "COM5"
            | "COM6" | "COM7" | "COM8" | "COM9"
            | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5"
            | "LPT6" | "LPT7" | "LPT8" | "LPT9"
    );
    if is_reserved {
        return format!("{safe}_");
    }

    safe
}


async fn reserve_destination(directory: &Path, file_name: &str) -> Result<PathBuf> {
    fs::create_dir_all(directory).await?;
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("download");
    let extension = path.extension().and_then(|v| v.to_str());
    for counter in 0..10_000 {
        let name = if counter == 0 {
            file_name.to_owned()
        } else {
            match extension {
                Some(ext) => format!("{stem} ({counter}).{ext}"),
                None => format!("{stem} ({counter})"),
            }
        };
        let candidate = directory.join(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
            .await
        {
            Ok(_) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(EngineError::Message(format!(
        "could not reserve a destination for {file_name}"
    )))
}

struct UrlCheck;
impl UrlCheck {
    fn validate(value: &str) -> Result<()> {
        let url = url::Url::parse(value)?;
        if matches!(url.scheme(), "http" | "https" | "magnet" | "file") {
            return Ok(());
        }
        Err(EngineError::Message(
            "only HTTP(S), magnet, and local .torrent downloads are supported".into(),
        ))
    }
}

async fn run_torrent_job(
    inner: Arc<Inner>,
    id: String,
    req: StartDownloadRequest,
    existing_destination: Option<PathBuf>,
) -> Result<()> {
    let suggested = if req.suggested_file_name.is_empty() {
        if req.url.starts_with("magnet:") {
            crate::torrent::parse_magnet_info_hash(&req.url)
                .map(|hash| format!("{hash}.torrent"))
                .unwrap_or_else(|_| "torrent-download".into())
        } else {
            Path::new(&req.url)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("torrent-download")
                .to_owned()
        }
    } else {
        req.suggested_file_name.clone()
    };
    let file_name = sanitize_file_name(&suggested);
    let destination = match existing_destination {
        Some(path) => path,
        None => reserve_destination(&req.destination_dir, &file_name).await?,
    };

    let mut state = DownloadState {
        id: id.clone(),
        url: req.url.clone(),
        file_name,
        destination_path: destination.clone(),
        total_bytes: req.total_bytes,
        bytes_downloaded: 0,
        speed_bytes_per_sec: 0,
        status: DownloadStatus::Downloading,
        chunks: vec![],
        blocks: vec![],
        total_blocks: Some(0),
        block_size_bytes: None,
        error: None,
        started_at: now_ms(),
        paused_at: None,
        total_paused_ms: 0,
        completed_at: None,
        assembled_bytes: None,
    };
    inner.active.write().insert(id.clone(), state.clone());
    emit(&inner, state.clone());

    let engine = crate::torrent::default_engine();
    match engine.start(&req.url, &destination).await {
        Ok(_) => {
            state.status = DownloadStatus::Completed;
            state.completed_at = Some(now_ms());
            inner.active.write().insert(id.clone(), state.clone());
            emit(&inner, state);
            Ok(())
        }
        Err(error) => {
            state.status = DownloadStatus::Error;
            state.error = Some(error.to_string());
            inner.active.write().insert(id.clone(), state.clone());
            emit(&inner, state);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrency_defaults_and_clamps() {
        let temp_dir = std::env::temp_dir().join(format!("flexo_mgr_test_{}", uuid::Uuid::new_v4()));
        let manager = DownloadManager::new(temp_dir.clone(), Arc::new(|_| {}));
        assert_eq!(manager.get_max_concurrent(), DEFAULT_MAX_CONCURRENT);
        assert_eq!(manager.get_max_concurrent(), 6);

        manager.set_max_concurrent(100);
        assert_eq!(manager.get_max_concurrent(), 100);

        manager.set_max_concurrent(500); // clamped to 100
        assert_eq!(manager.get_max_concurrent(), 100);

        manager.set_max_concurrent(0); // clamped to 1
        assert_eq!(manager.get_max_concurrent(), 1);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn queue_respects_concurrency_slots() {
        let temp_dir = std::env::temp_dir().join(format!("flexo_mgr_test_{}", uuid::Uuid::new_v4()));
        let manager = DownloadManager::new(temp_dir.clone(), Arc::new(|_| {}));
        // Set max_concurrent to 0 or simulate active downloads so items stay in queue
        manager.set_max_concurrent(2);

        // Insert 2 active downloading items into inner.active to occupy both slots
        for i in 0..2 {
            let active_id = format!("active_{i}");
            let dummy_state = DownloadState {
                id: active_id.clone(),
                url: format!("https://example.com/active_{i}.mp4"),
                file_name: format!("active_{i}.mp4"),
                destination_path: temp_dir.join(format!("active_{i}.mp4")),
                speed_bytes_per_sec: 1000,
                status: DownloadStatus::Downloading,
                total_bytes: 1000,
                bytes_downloaded: 500,
                total_blocks: Some(1),
                block_size_bytes: Some(1000),
                blocks: vec![],
                chunks: vec![],
                error: None,
                started_at: now_ms(),
                paused_at: None,
                total_paused_ms: 0,
                completed_at: None,
                assembled_bytes: None,
            };
            manager.inner.active.write().insert(active_id, dummy_state);
        }

        // Now enqueue 3 items
        for i in 0..3 {
            let req = StartDownloadRequest {
                url: format!("https://example.com/movie_{i}.mp4"),
                destination_dir: temp_dir.clone(),
                suggested_file_name: format!("movie_{i}.mp4"),
                total_bytes: 1000,
                supports_ranges: true,
                interface_ids: vec![],
                chunk_count: 1,
                connections_per_network: None,
                etag: None,
                last_modified: None,
                mirror_urls: vec![],
                max_block_bytes: None,
            };
            manager.enqueue(req).await.unwrap();
        }

        // Since both concurrent slots (2) are occupied by active downloading tasks,
        // all 3 enqueued items must stay in the queue!
        assert_eq!(manager.list_queue().len(), 3);

        // When 1 active download finishes (status becomes Completed):
        manager.inner.active.write().get_mut("active_0").unwrap().status = DownloadStatus::Completed;
        manager.pump_queue();

        // 1 slot freed, so 1 item popped from queue and launched, leaving 2 in queue
        assert_eq!(manager.list_queue().len(), 2);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}

