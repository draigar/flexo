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
                updates,
                on_update,
            }),
        }
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
        if force_queue {
            self.inner.queue.lock().push_back(QueueItem {
                id: id.clone(),
                url: req.url.clone(),
                file_name: req.suggested_file_name.clone(),
                status: QueueItemStatus::Waiting,
                added_at: now_ms(),
                request: req,
            });
            self.persist_manifest().await?;
        } else {
            self.launch(id.clone(), req, None);
        }
        Ok(id)
    }

    fn launch(&self, id: String, req: StartDownloadRequest, destination: Option<PathBuf>) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            if let Err(error) = run_job(inner.clone(), id.clone(), req, destination).await {
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
            }
            inner.cancels.lock().remove(&id);
            inner.speeds.lock().remove(&id);
            let manager = DownloadManager { inner };
            manager.start_next();
        });
    }

    fn start_next(&self) {
        if let Some(next) = self.inner.queue.lock().pop_front() {
            self.launch(next.id, next.request, None);
        }
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
        self.persist_manifest().await
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
        self.start_next();
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
        self.inner.active.read().values().cloned().collect()
    }

    pub fn list_queue(&self) -> Vec<QueueItem> {
        self.inner.queue.lock().iter().cloned().collect()
    }

    pub async fn persist_manifest(&self) -> Result<()> {
        fs::create_dir_all(&self.inner.data_dir).await?;
        let payload = serde_json::to_vec_pretty(&self.list_queue())?;
        let temp = self.inner.data_dir.join("queue.json.tmp");
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
    let plan = plan_download(PlanRequest {
        total_bytes: probe.total_bytes.unwrap_or(req.total_bytes),
        splittable: probe.supports_ranges && req.supports_ranges,
        network_count: interfaces.len(),
        streams_per_network: req
            .connections_per_network
            .unwrap_or_else(|| req.chunk_count.div_ceil(interfaces.len()).max(1)),
        max_block_bytes: req.max_block_bytes,
    });
    let mut blocks: Vec<_> = (0..plan.block_count)
        .map(|index| {
            let start = index as u64 * plan.block_size_bytes;
            BlockState {
                index,
                range_start: start,
                range_end: Some(
                    (start + plan.block_size_bytes.saturating_sub(1)).min(
                        probe
                            .total_bytes
                            .unwrap_or(req.total_bytes)
                            .saturating_sub(1),
                    ),
                ),
                status: BlockStatus::Pending,
                interface_id: None,
                bytes_downloaded: 0,
                bytes_by_interface: HashMap::new(),
            }
        })
        .collect();
    let chunks = plan
        .stream_networks
        .iter()
        .enumerate()
        .map(|(id, network)| ChunkState {
            id,
            interface_id: interfaces[*network].0.clone(),
            interface_label: interfaces[*network].1.clone(),
            interface_kind: interfaces[*network].2.clone(),
            range_start: 0,
            range_end: None,
            bytes_downloaded: 0,
            error: None,
            retry_count: 0,
            current_block_index: None,
            hedge: None,
            status: ChunkStatus::Pending,
            speed_bytes_per_sec: 0,
        })
        .collect();
    let total_bytes = probe.total_bytes.unwrap_or(req.total_bytes);

    let cancel = CancellationToken::new();
    inner.cancels.lock().insert(id.clone(), cancel.clone());
    inner.speeds.lock().insert(id.clone(), SpeedRuntime::default());

    let parts_dir = inner.data_dir.join("parts").join(&id);
    fs::create_dir_all(&parts_dir).await?;

    // Check existing part files on disk to resume previously completed blocks!
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
            if meta.len() >= expected_len {
                block.status = BlockStatus::Completed;
                block.bytes_downloaded = expected_len;
                initial_downloaded += expected_len;
                continue;
            }
        }
        pending_indices.push_back(i);
    }
    let pending_queue = Arc::new(Mutex::new(pending_indices));

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
        started_at: now_ms(),
        paused_at: None,
        total_paused_ms: 0,
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
        let (_, _, _, local_address) = interfaces[network_index].clone();
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
                let (start, end, interface_id) = {
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
                    )
                };
                let source_index = index % (req.mirror_urls.len() + 1);
                let source = if source_index == 0 {
                    &req.url
                } else {
                    &req.mirror_urls[source_index - 1]
                };
                let path = part_files::part_file(&parts_dir, &id, index);
                let mut last_position = 0_u64;
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
    let parts: Vec<_> = (0..plan.block_count)
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
    part_files::assemble(&parts, &destination).await?;
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
    let safe: String = name
        .chars()
        .map(|ch| {
            if ch == '/' || ch == '\\' || ch.is_control() {
                '_'
            } else {
                ch
            }
        })
        .collect();
    if safe.is_empty() || safe.chars().all(|ch| ch == '.') {
        "download".into()
    } else {
        safe
    }
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
