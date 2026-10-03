#![allow(non_snake_case)]

mod history;
mod native_messaging;

use flexo_engine::plan::{plan_download, PlanRequest};
use flexo_engine::{
    AppSettings, DownloadState, Engine, MediaCandidate, NetworkInterfaceInfo, ProbeResult,
    QueueItem, SegmentPreset, StartDownloadRequest, ThemeSource,
};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{
    tray::{MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, State, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

type CommandResult<T> = Result<T, String>;

struct AppState {
    engine: Engine,
    settings: RwLock<AppSettings>,
    media: Mutex<HashMap<String, MediaCandidate>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InitialState {
    home_dir: PathBuf,
    downloads_dir: PathBuf,
    is_dev: bool,
    theme_source: ThemeSource,
    network_preferences: HashMap<String, flexo_engine::NetworkPreference>,
    #[serde(skip_serializing_if = "Option::is_none")]
    streams_per_network: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    destination_dir: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    segment_preset: Option<flexo_engine::SegmentPreset>,
    auto_download: bool,
    watch_clipboard: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_concurrent_downloads: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    version: String,
    url: String,
    dismissed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulatedDownloadRequest {
    source_file_path: PathBuf,
    destination_dir: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureRequest {
    url: String,
    file_name: Option<String>,
    #[allow(dead_code)]
    referrer: Option<String>,
    #[allow(dead_code)]
    cookie_header: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureFailure {
    url: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum MediaRequest {
    List(Vec<MediaCandidate>),
    Wrapped { candidates: Vec<MediaCandidate> },
}

fn error_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
async fn listInterfaces(state: State<'_, AppState>) -> CommandResult<Vec<NetworkInterfaceInfo>> {
    state.engine.list_interfaces().await.map_err(error_string)
}

#[tauri::command]
async fn pingInterfaces(state: State<'_, AppState>) -> CommandResult<HashMap<String, Option<u64>>> {
    state.engine.ping_interfaces().await.map_err(error_string)
}

#[tauri::command]
fn deviceBindingSupported(state: State<'_, AppState>) -> bool {
    state.engine.device_binding_supported()
}

#[tauri::command]
fn openNetworkSettings() -> CommandResult<()> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "macos")]
    command.arg("x-apple.systempreferences:com.apple.Network-Settings.extension");

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", "ms-settings:network"]);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = std::process::Command::new("sh");
        command.args(["-c", "nm-connection-editor || gnome-control-center network"]);
        command
    };

    command.spawn().map(|_| ()).map_err(error_string)
}

#[tauri::command]
async fn updateSettings(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: AppSettings,
) -> CommandResult<()> {
    let merged = {
        let mut settings = state.settings.write();
        merge_settings(&mut settings, payload);
        settings.clone()
    };
    if let Some(limit) = merged.max_concurrent_downloads {
        state.engine.set_max_concurrent_downloads(limit);
    }
    state
        .engine
        .save_settings(merged)
        .await
        .map_err(error_string)?;
    let _ = app.emit("queue:updated", state.engine.get_queue().await);
    Ok(())
}

#[tauri::command]
async fn probeUrl(state: State<'_, AppState>, payload: String) -> CommandResult<ProbeResult> {
    state.engine.probe_url(payload).await.map_err(error_string)
}

#[tauri::command]
async fn chooseDestinationFolder(payload: String) -> CommandResult<Option<String>> {
    let directory = existing_directory(&payload);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new().set_title("Choose download folder");
        if let Some(directory) = directory {
            dialog = dialog.set_directory(directory);
        }
        dialog.pick_folder()
    })
    .await
    .map_err(error_string)?;
    Ok(picked.map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn chooseSourceFile() -> CommandResult<Option<String>> {
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Choose a file")
            .pick_file()
    })
    .await
    .map_err(error_string)?;
    Ok(picked.map(|path| path.to_string_lossy().into_owned()))
}

fn existing_directory(path: &str) -> Option<PathBuf> {
    let mut path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return None;
    }
    if path.is_file() {
        path.pop();
    }
    path.is_dir().then_some(path)
}

#[tauri::command]
fn readClipboardText(app: AppHandle) -> CommandResult<String> {
    app.clipboard().read_text().map_err(error_string)
}

#[tauri::command]
fn revealInFolder(app: AppHandle, payload: String) -> CommandResult<()> {
    app.opener()
        .reveal_item_in_dir(payload)
        .map_err(error_string)
}

#[tauri::command]
async fn startDownload(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: StartDownloadRequest,
) -> CommandResult<String> {
    let id = state
        .engine
        .start_download(payload)
        .await
        .map_err(error_string)?;
    emit_queue(&app, &state.engine).await;
    Ok(id)
}

#[tauri::command]
async fn startSimulatedDownload(
    state: State<'_, AppState>,
    payload: SimulatedDownloadRequest,
) -> CommandResult<String> {
    let metadata = tokio::fs::metadata(&payload.source_file_path)
        .await
        .map_err(error_string)?;
    let file_name = payload
        .source_file_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("simulated-download")
        .to_owned();
    let request = StartDownloadRequest {
        url: format!("file://{}", payload.source_file_path.display()),
        destination_dir: payload.destination_dir,
        suggested_file_name: file_name,
        total_bytes: metadata.len(),
        supports_ranges: false,
        interface_ids: Vec::new(),
        chunk_count: 1,
        connections_per_network: Some(1),
        etag: None,
        last_modified: None,
        mirror_urls: Vec::new(),
        max_block_bytes: None,
    };
    state
        .engine
        .start_download(request)
        .await
        .map_err(error_string)
}

#[tauri::command]
async fn getCurrentDownload(state: State<'_, AppState>) -> CommandResult<Option<DownloadState>> {
    Ok(state.engine.get_current().await)
}

#[tauri::command]
async fn getActiveDownloads(state: State<'_, AppState>) -> CommandResult<Vec<DownloadState>> {
    Ok(state.engine.get_active().await)
}

#[tauri::command]
async fn pauseDownload(state: State<'_, AppState>, payload: String) -> CommandResult<()> {
    state.engine.pause(payload).await.map_err(error_string)
}

#[tauri::command]
async fn resumeDownload(state: State<'_, AppState>, payload: String) -> CommandResult<()> {
    state.engine.resume(payload).await.map_err(error_string)
}

#[tauri::command]
async fn cancelDownload(state: State<'_, AppState>, payload: String) -> CommandResult<()> {
    state.engine.cancel(payload).await.map_err(error_string)
}

#[tauri::command]
async fn removeDownload(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: String,
) -> CommandResult<()> {
    state.engine.remove(payload).await.map_err(error_string)?;
    emit_queue(&app, &state.engine).await;
    Ok(())
}

#[tauri::command]
async fn checkForUpdate(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Option<UpdateInfo>> {
    let url = "https://api.github.com/repos/draigar/flexo/releases/latest";
    let client = reqwest::Client::builder()
        .user_agent("Flexo App")
        .build()
        .map_err(error_string)?;

    if let Ok(response) = client.get(url).send().await {
        if let Ok(release) = response.json::<serde_json::Value>().await {
            if let Some(tag_name) = release.get("tag_name").and_then(|v| v.as_str()) {
                let latest_version = tag_name.trim_start_matches('v');
                let current_version = app.package_info().version.to_string();

                if latest_version != current_version {
                    let dismissed = state
                        .settings
                        .read()
                        .dismissed_update_version
                        .as_deref()
                        == Some(latest_version);

                    let mut download_url = release
                        .get("html_url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("https://github.com/draigar/flexo/releases/latest")
                        .to_string();

                    if let Some(assets) = release.get("assets").and_then(|v| v.as_array()) {
                        let os = std::env::consts::OS;
                        let ext = match os {
                            "macos" => ".dmg",
                            "windows" => ".exe",
                            "linux" => ".AppImage",
                            _ => "",
                        };
                        
                        for asset in assets {
                            if let Some(name) = asset.get("name").and_then(|v| v.as_str()) {
                                if !ext.is_empty() && name.ends_with(ext) {
                                    if let Some(browser_download_url) = asset
                                        .get("browser_download_url")
                                        .and_then(|v| v.as_str())
                                    {
                                        download_url = browser_download_url.to_string();
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    return Ok(Some(UpdateInfo {
                        version: latest_version.to_string(),
                        url: download_url,
                        dismissed,
                    }));
                }
            }
        }
    }
    Ok(None)
}

#[tauri::command]
fn getInitialState(state: State<'_, AppState>) -> InitialState {
    let settings = state.settings.read().clone();
    InitialState {
        home_dir: dirs::home_dir().unwrap_or_default(),
        downloads_dir: dirs::download_dir().unwrap_or_default(),
        is_dev: cfg!(debug_assertions),
        theme_source: settings.theme_source.unwrap_or(ThemeSource::Dark),
        network_preferences: settings.network_preferences.unwrap_or_default(),
        streams_per_network: settings.streams_per_network,
        destination_dir: settings.destination_dir,
        segment_preset: settings.segment_preset,
        auto_download: settings.auto_download.unwrap_or(true),
        watch_clipboard: settings.watch_clipboard.unwrap_or(true),
        max_concurrent_downloads: settings.max_concurrent_downloads,
    }
}

#[tauri::command]
async fn getQueue(state: State<'_, AppState>) -> CommandResult<Vec<QueueItem>> {
    Ok(state.engine.get_queue().await)
}

#[tauri::command]
async fn enqueueDownload(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: StartDownloadRequest,
) -> CommandResult<String> {
    let id = state.engine.enqueue(payload).await.map_err(error_string)?;
    emit_queue(&app, &state.engine).await;
    Ok(id)
}

#[tauri::command]
async fn resolveMedia(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> CommandResult<Vec<MediaCandidate>> {
    let candidates = state
        .engine
        .resolve_media(url)
        .await
        .map_err(error_string)?;
    {
        let mut media = state.media.lock();
        for candidate in &candidates {
            media.insert(candidate.id.clone(), candidate.clone());
        }
    }
    let _ = app.emit("media:candidates", &candidates);
    Ok(candidates)
}

#[tauri::command]
async fn startMediaDownload(
    state: State<'_, AppState>,
    candidateId: String,
    mut payload: StartDownloadRequest,
) -> CommandResult<String> {
    let candidate = state
        .media
        .lock()
        .get(&candidateId)
        .cloned()
        .ok_or_else(|| format!("unknown media candidate {candidateId}"))?;
    if candidate.drm {
        return Err(candidate
            .unsupported_reason
            .unwrap_or_else(|| "DRM-protected media is not supported".to_owned()));
    }
    payload.url = candidate.url;
    state
        .engine
        .start_download(payload)
        .await
        .map_err(error_string)
}

async fn emit_queue(app: &AppHandle, engine: &Engine) {
    let _ = app.emit("queue:updated", engine.get_queue().await);
}

fn merge_settings(current: &mut AppSettings, patch: AppSettings) {
    if patch.theme_source.is_some() {
        current.theme_source = patch.theme_source;
    }
    if patch.dismissed_update_version.is_some() {
        current.dismissed_update_version = patch.dismissed_update_version;
    }
    if patch.streams_per_network.is_some() {
        current.streams_per_network = patch.streams_per_network;
    }
    if patch.destination_dir.is_some() {
        current.destination_dir = patch.destination_dir;
    }
    if patch.network_preferences.is_some() {
        current.network_preferences = patch.network_preferences;
    }
    if patch.segment_preset.is_some() {
        current.segment_preset = patch.segment_preset;
    }
    if patch.auto_download.is_some() {
        current.auto_download = patch.auto_download;
    }
    if patch.watch_clipboard.is_some() {
        current.watch_clipboard = patch.watch_clipboard;
    }
    if patch.max_concurrent_downloads.is_some() {
        current.max_concurrent_downloads = patch.max_concurrent_downloads;
    }
}

fn is_download_url(url: &str) -> bool {
    let url = url.trim();
    url.starts_with("http://") || url.starts_with("https://") || url.starts_with("magnet:")
}

fn capture_file_name(value: Option<String>) -> Option<String> {
    let value = value?.trim().to_owned();
    if value.is_empty() {
        return None;
    }
    let name = std::path::Path::new(&value)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(value.as_str())
        .trim()
        .to_owned();
    (!name.is_empty()).then_some(name)
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(
                std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or(""),
                16,
            ) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn capture_from_link(link: &str) -> Option<CaptureRequest> {
    let query = link.trim().strip_prefix("flexo://")?.split_once('?')?.1;
    let mut url = None;
    let mut file_name = None;
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        let decoded = percent_decode(value);
        match key {
            "url" => url = Some(decoded),
            "fileName" => file_name = Some(decoded),
            _ => {}
        }
    }
    let url = url.filter(|value| is_download_url(value))?;
    Some(CaptureRequest {
        url,
        file_name: capture_file_name(file_name),
        referrer: None,
        cookie_header: None,
    })
}

fn present_main_window(app: &AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}

static LAST_POPOVER_SHOW_MS: AtomicU64 = AtomicU64::new(0);

fn toggle_tray_popover(app: &AppHandle, rect: Option<tauri::Rect>) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(popover) = app.get_webview_window("tray-popover") {
            let is_visible = popover.is_visible().unwrap_or(false);
            if is_visible {
                let _ = popover.hide();
            } else {
                let scale_factor = popover.scale_factor().unwrap_or(1.0);
                let popover_w = 320.0;
                let popover_h = 480.0;
                let (popover_x, popover_y) = if let Some(r) = rect {
                    let (rx, ry) = match r.position {
                        tauri::Position::Physical(p) => {
                            (p.x as f64 / scale_factor, p.y as f64 / scale_factor)
                        }
                        tauri::Position::Logical(p) => (p.x, p.y),
                    };
                    let (rw, rh) = match r.size {
                        tauri::Size::Physical(s) => {
                            (s.width as f64 / scale_factor, s.height as f64 / scale_factor)
                        }
                        tauri::Size::Logical(s) => (s.width, s.height),
                    };
                    let center_x = rx + (rw / 2.0);
                    let mut x = center_x - (popover_w / 2.0);
                    if let Ok(Some(mon)) = popover.current_monitor() {
                        let mon_w = mon.size().width as f64 / mon.scale_factor();
                        if x + popover_w > mon_w - 8.0 {
                            x = mon_w - popover_w - 8.0;
                        }
                    }
                    x = x.max(8.0);
                    let y = if ry > 300.0 {
                        (ry - popover_h - 8.0).max(10.0)
                    } else {
                        ry + rh + 4.0
                    };
                    (x, y)
                } else if let Ok(Some(mon)) = popover.primary_monitor() {
                    let mon_w = mon.size().width as f64 / mon.scale_factor();
                    ((mon_w - popover_w - 12.0).max(10.0), 32.0)
                } else {
                    (800.0, 32.0)
                };

                let _ = popover.set_size(Size::Logical(LogicalSize::new(popover_w, popover_h)));
                let _ = popover.set_position(Position::Logical(LogicalPosition::new(
                    popover_x,
                    popover_y,
                )));

                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                LAST_POPOVER_SHOW_MS.store(now, Ordering::SeqCst);

                let _ = popover.show();
                let _ = popover.set_focus();
            }
        }
    });
}

fn update_tray_badge(app: &AppHandle, active_count: usize) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        #[cfg(target_os = "macos")]
        {
            if active_count > 0 {
                let _ = tray.set_title(Some(format!(" {active_count}")));
            } else {
                let _ = tray.set_title(None::<String>);
            }
        }
        let tooltip = if active_count > 0 {
            format!("Flexo ({active_count} active)")
        } else {
            "Flexo".to_string()
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

fn setup_tray_popover(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(popover) = app.get_webview_window("tray-popover") {
        let _ = popover.set_shadow(true);
        let _ = popover.set_size(Size::Logical(LogicalSize::new(320.0, 480.0)));
        return Ok(());
    }

    let _popover = WebviewWindowBuilder::new(
        app,
        "tray-popover",
        WebviewUrl::default(),
    )
    .title("Flexo")
    .inner_size(320.0, 480.0)
    .decorations(false)
    .resizable(false)
    .shadow(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()?;

    Ok(())
}

#[tauri::command]
async fn presentMainWindow(app: AppHandle) -> CommandResult<()> {
    present_main_window(&app);
    Ok(())
}

#[tauri::command]
async fn hideTrayPopover(app: AppHandle) -> CommandResult<()> {
    if let Some(popover) = app.get_webview_window("tray-popover") {
        let _ = popover.hide();
    }
    Ok(())
}

#[tauri::command]
async fn quitApp(app: AppHandle) -> CommandResult<()> {
    let _ = app.remove_tray_by_id("main-tray");
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn getNetworkSpeeds(
    state: State<'_, AppState>,
) -> CommandResult<flexo_engine::NetworkSpeedSnapshot> {
    Ok(state.engine.get_network_speeds().await)
}

#[tauri::command]
async fn triggerSpeedTest(
    state: State<'_, AppState>,
) -> CommandResult<flexo_engine::NetworkSpeedSnapshot> {
    Ok(state.engine.test_network_speeds().await)
}

fn accept_capture(app: AppHandle, mut capture: CaptureRequest) {
    capture.url = capture.url.trim().to_owned();
    capture.file_name = capture_file_name(capture.file_name);
    if !is_download_url(&capture.url) {
        return;
    }
    present_main_window(&app);
    let _ = app.emit("clipboard:url", capture.url.clone());
    let auto_download = app
        .state::<AppState>()
        .settings
        .read()
        .auto_download
        .unwrap_or(true);
    if !auto_download {
        return;
    }
    tauri::async_runtime::spawn(async move {
        if let Err(message) = grab_download(&app, capture.clone()).await {
            let _ = app.emit(
                "capture:error",
                CaptureFailure {
                    url: capture.url,
                    message,
                },
            );
        }
    });
}

async fn grab_download(app: &AppHandle, capture: CaptureRequest) -> Result<(), String> {
    if capture.url.starts_with("magnet:") {
        return Ok(());
    }
    let state = app.state::<AppState>();
    let settings = state.settings.read().clone();
    let destination_dir = if let Some(dir) = settings
        .destination_dir
        .clone()
        .filter(|path| path.is_dir())
    {
        dir
    } else {
        let dir =
            dirs::download_dir().ok_or_else(|| "No download folder is available".to_owned())?;
        std::fs::create_dir_all(&dir).map_err(error_string)?;
        dir
    };
    let probe = state
        .engine
        .probe_url(capture.url.clone())
        .await
        .map_err(error_string)?;
    let interfaces = state.engine.list_interfaces().await.map_err(error_string)?;
    if interfaces.is_empty() {
        return Err("No network connections are available".to_owned());
    }
    let splittable = probe.supports_ranges && probe.total_bytes.is_some();
    let selected: Vec<&NetworkInterfaceInfo> = if splittable {
        interfaces.iter().collect()
    } else {
        interfaces.iter().take(1).collect()
    };
    let streams = if splittable {
        settings.streams_per_network.unwrap_or(2).clamp(1, 8)
    } else {
        1
    };
    let max_block_bytes = settings
        .segment_preset
        .unwrap_or(SegmentPreset::Auto)
        .bytes();
    let plan = plan_download(PlanRequest {
        total_bytes: probe.total_bytes.unwrap_or(0),
        splittable,
        network_count: selected.len(),
        streams_per_network: streams,
        max_block_bytes,
    });
    let request = StartDownloadRequest {
        url: probe.final_url,
        destination_dir,
        suggested_file_name: capture
            .file_name
            .filter(|name| !name.is_empty())
            .unwrap_or(probe.suggested_file_name),
        total_bytes: probe.total_bytes.unwrap_or(0),
        supports_ranges: splittable,
        interface_ids: selected.into_iter().map(|iface| iface.id.clone()).collect(),
        chunk_count: plan.stream_networks.len().max(1),
        connections_per_network: Some(streams),
        etag: probe.etag,
        last_modified: probe.last_modified,
        mirror_urls: Vec::new(),
        max_block_bytes: Some(plan.block_size_bytes),
    };
    state
        .engine
        .start_download(request)
        .await
        .map_err(error_string)?;
    emit_queue(app, &state.engine).await;
    Ok(())
}

fn capture_extension_manifest(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("extensions/browser/manifest.json"));
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../extensions/browser/manifest.json");
    [bundled, Some(dev)]
        .into_iter()
        .flatten()
        .find(|path| path.is_file())
        .ok_or_else(|| "The Flexo browser extension folder was not found".to_owned())
}

#[tauri::command]
fn revealCaptureExtension(app: AppHandle) -> CommandResult<()> {
    let manifest = capture_extension_manifest(&app)?;
    app.opener()
        .reveal_item_in_dir(manifest)
        .map_err(error_string)
}

#[tauri::command]
fn listDownloadHistory(
    history: State<'_, history::HistoryDb>,
) -> CommandResult<Vec<history::DownloadRecord>> {
    history.list()
}

#[tauri::command]
fn removeDownloadHistory(
    history: State<'_, history::HistoryDb>,
    payload: String,
) -> CommandResult<()> {
    history.remove(&payload)
}

fn spawn_clipboard_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last = String::new();
        loop {
            let watch = app
                .state::<AppState>()
                .settings
                .read()
                .watch_clipboard
                .unwrap_or(true);
            if watch {
                if let Ok(text) = app.clipboard().read_text() {
                    let trimmed = text.trim();
                    if trimmed != last
                        && (trimmed.starts_with("http://")
                            || trimmed.starts_with("https://")
                            || trimmed.starts_with("magnet:"))
                    {
                        last = trimmed.to_owned();
                        let _ = app.emit("clipboard:url", trimmed);
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}

fn spawn_handoff_server(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind("127.0.0.1:17890").await {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("Flexo capture server failed to listen on 127.0.0.1:17890: {error}");
                return;
            }
        };
        while let Ok((stream, _)) = listener.accept().await {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = handle_handoff(stream, app).await;
            });
        }
    });
}

async fn handle_handoff(mut stream: TcpStream, app: AppHandle) -> CommandResult<()> {
    let mut bytes = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 2048];
    let (header_end, content_length) = loop {
        let read = stream.read(&mut buffer).await.map_err(error_string)?;
        if read == 0 {
            return Err("incomplete HTTP request".to_owned());
        }
        bytes.extend_from_slice(&buffer[..read]);
        if let Some(end) = find_header_end(&bytes) {
            let headers = String::from_utf8_lossy(&bytes[..end]);
            let length = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':').and_then(|(name, value)| {
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                })
                .unwrap_or(0);
            break (end, length);
        }
        if bytes.len() > 1024 * 1024 {
            return Err("HTTP request headers are too large".to_owned());
        }
    };
    let body_start = header_end + 4;
    while bytes.len() < body_start + content_length {
        let read = stream.read(&mut buffer).await.map_err(error_string)?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
    }
    let request_line = String::from_utf8_lossy(&bytes[..header_end])
        .lines()
        .next()
        .unwrap_or_default()
        .to_owned();
    let body = &bytes[body_start..bytes.len().min(body_start + content_length)];
    if request_line.starts_with("OPTIONS ") {
        let response = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        return stream
            .write_all(response.as_bytes())
            .await
            .map_err(error_string);
    }
    let result = if request_line.starts_with("POST /capture ") {
        serde_json::from_slice::<CaptureRequest>(body)
            .map_err(error_string)
            .and_then(|capture| {
                if is_download_url(&capture.url) {
                    accept_capture(app.clone(), capture);
                    Ok(())
                } else {
                    Err("only HTTP(S) and magnet links can be captured".to_owned())
                }
            })
    } else if request_line.starts_with("POST /media ") {
        serde_json::from_slice::<MediaRequest>(body)
            .map_err(error_string)
            .and_then(|request| {
                let candidates = match request {
                    MediaRequest::List(candidates) | MediaRequest::Wrapped { candidates } => {
                        candidates
                    }
                };
                app.emit("media:candidates", candidates)
                    .map_err(error_string)
            })
    } else {
        Err("unknown handoff endpoint".to_owned())
    };
    let (status, payload) = match result {
        Ok(()) => ("200 OK", r#"{"ok":true}"#),
        Err(_) => ("400 Bad Request", r#"{"ok":false}"#),
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(error_string)
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if app.tray_by_id("main-tray").is_some() {
        return Ok(());
    }

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Flexo");

    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    builder = builder
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_tray_popover(tray.app_handle(), Some(rect));
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

pub fn run_native_messaging() {
    use std::io::{Read, Write};
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut stdin = stdin.lock();
    let mut stdout = stdout.lock();

    loop {
        let mut len_buf = [0u8; 4];
        if stdin.read_exact(&mut len_buf).is_err() {
            break;
        }
        let len = u32::from_ne_bytes(len_buf) as usize;
        if len == 0 || len > 10 * 1024 * 1024 {
            break;
        }

        let mut body = vec![0u8; len];
        if stdin.read_exact(&mut body).is_err() {
            break;
        }

        let response = forward_to_handoff(&body);

        let resp_bytes = response.as_bytes();
        let resp_len = (resp_bytes.len() as u32).to_ne_bytes();
        if stdout.write_all(&resp_len).is_err() {
            break;
        }
        if stdout.write_all(resp_bytes).is_err() {
            break;
        }
        let _ = stdout.flush();
    }
}

fn forward_to_handoff(body: &[u8]) -> String {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let Ok(mut stream) = TcpStream::connect("127.0.0.1:17890") else {
        return r#"{"ok":false,"error":"Flexo is not running"}"#.to_owned();
    };

    let is_media = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|val| val.get("candidates").cloned())
        .is_some();
    let path = if is_media { "/media" } else { "/capture" };

    let request = format!(
        "POST {} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        path,
        body.len()
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return r#"{"ok":false,"error":"failed to write request"}"#.to_owned();
    }
    if stream.write_all(body).is_err() {
        return r#"{"ok":false,"error":"failed to write body"}"#.to_owned();
    }
    let _ = stream.flush();

    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);

    if let Some((_, json_body)) = response.split_once("\r\n\r\n") {
        let trimmed = json_body.trim();
        if !trimmed.is_empty() {
            return trimmed.to_owned();
        }
    }
    r#"{"ok":true}"#.to_owned()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            present_main_window(app);
            for arg in argv {
                if let Some(capture) = capture_from_link(&arg) {
                    accept_capture(app.clone(), capture);
                }
            }
        }))
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(error_string)?;
            std::fs::create_dir_all(&data_dir).map_err(error_string)?;
            let history = history::HistoryDb::open(&data_dir.join("downloads.db"))?;
            let history_for_updates = history.clone();
            let handle = app.handle().clone();
            let snapshot_engine_dir = data_dir.clone();
            let speed_handle = handle.clone();
            let badge_handle = handle.clone();
            let engine = Engine::new(
                data_dir,
                Arc::new(move |state| {
                    if history_for_updates.record(&state) {
                        let _ = handle.emit("history:updated", ());
                    }
                    let _ = handle.emit("download:updated", &state);
                    // Best-effort widget snapshot for macOS/Windows glance surfaces.
                    let snapshot_path = snapshot_engine_dir.join("widget-snapshot.json");
                    let _ = flexo_engine::snapshot::write_snapshot_sync(
                        &snapshot_path,
                        &flexo_engine::WidgetSnapshot {
                            current: Some(state),
                            queue: Vec::new(),
                            written_at: std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|duration| duration.as_millis() as u64)
                                .unwrap_or(0),
                        },
                    );
                }),
                Some(Arc::new(move |snapshot| {
                    let _ = speed_handle.emit("network:speeds", snapshot);
                })),
            );

            let badge_engine = engine.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(1500));
                loop {
                    interval.tick().await;
                    let active = badge_engine.get_active().await;
                    let count = active
                        .iter()
                        .filter(|d| d.status == flexo_engine::DownloadStatus::Downloading)
                        .count();
                    update_tray_badge(&badge_handle, count);
                }
            });

            let bg_engine = engine.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let _ = bg_engine.test_network_speeds().await;

                let mut interval = tokio::time::interval(Duration::from_secs(20));
                loop {
                    interval.tick().await;
                    let _ = bg_engine.test_network_speeds().await;
                }
            });

            let settings =
                tauri::async_runtime::block_on(engine.load_settings()).unwrap_or_default();
            if let Some(limit) = settings.max_concurrent_downloads {
                engine.set_max_concurrent_downloads(limit);
            }
            app.manage(history);
            app.manage(AppState {
                engine,
                settings: RwLock::new(settings),
                media: Mutex::new(HashMap::new()),
            });
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(capture) = capture_from_link(url.as_str()) {
                        accept_capture(handle.clone(), capture);
                    }
                }
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    if let Some(capture) = capture_from_link(url.as_str()) {
                        accept_capture(app.handle().clone(), capture);
                    }
                }
            }
            setup_tray_popover(app)?;
            setup_tray(app)?;
            native_messaging::register_browser_integrations(app.handle());
            spawn_clipboard_watcher(app.handle().clone());
            spawn_handoff_server(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "tray-popover" {
                if let WindowEvent::Focused(false) = event {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    let last_shown = LAST_POPOVER_SHOW_MS.load(Ordering::SeqCst);
                    if now.saturating_sub(last_shown) > 500 {
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            listInterfaces,
            pingInterfaces,
            deviceBindingSupported,
            openNetworkSettings,
            updateSettings,
            probeUrl,
            chooseDestinationFolder,
            chooseSourceFile,
            revealCaptureExtension,
            listDownloadHistory,
            removeDownloadHistory,
            readClipboardText,
            revealInFolder,
            startDownload,
            startSimulatedDownload,
            getCurrentDownload,
            getActiveDownloads,
            pauseDownload,
            resumeDownload,
            cancelDownload,
            removeDownload,
            checkForUpdate,
            getInitialState,
            getQueue,
            enqueueDownload,
            resolveMedia,
            startMediaDownload,
            presentMainWindow,
            hideTrayPopover,
            quitApp,
            getNetworkSpeeds,
            triggerSpeedTest
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flexo");
}
