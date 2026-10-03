# Changelog

All notable changes to Flexo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] - 2026-10-03

### Download Engine Overhaul — Reliable, Resumable & Cross-Platform

This release is a comprehensive rewrite of the download engine. The headline improvements are: large video files no longer fail mid-download, resuming a download picks up from the exact byte where it stopped (no rollback to 0%), and the app silently retries instead of popping an error dialog for temporary server hiccups.

#### Fixed

##### 1. Downloads Failing at ~17% (or Any Fixed Point)
- **Root cause**: The HTTP client had a hard 120-second total-request timeout. For a typical 1.4 GB video at ~2 MB/s, 120 seconds elapsed at exactly 17% of the file, killing every download at the same point every time.
- **Fix**: Removed the global request timeout entirely. Downloads can now stream for as long as the server keeps sending data. A 45-second *per-packet inactivity* timeout replaces it — the download is only aborted if no data arrives for 45 seconds, not if the transfer takes a long time.

##### 2. Resuming Rolled Back to 0%
- **Root cause**: When resuming, the engine reopened part files with `.truncate(true)`, erasing everything already downloaded, then started from byte 0.
- **Fix**: The engine now inspects how many bytes are already on disk for each block, issues a `Range: bytes=<saved_offset>-<end>` request, and appends from that position. Progress never moves backward.

##### 3. "Download Failed" Dialog for Temporary Errors (429 / 404 / 5xx)
- **Root cause**: Any single HTTP error (rate-limit, expired token, server blip) immediately marked the download as failed and showed the error dialog, even though the download stream was still healthy.
- **Fix**: Two retry layers added:
  - **Block-level (chunk.rs)**: Each block retries up to 8 times with exponential back-off. 429 Too Many Requests honours the server's `Retry-After` header. 404s are retried (Cloudflare Worker tokens can be refreshed).
  - **Job-level (manager.rs)**: If a job fails due to any transient error (network drop, rate limit, server error), the manager silently waits (2 s → 4 s → 8 s … 30 s) and re-runs the job from disk — up to 10 times — without ever showing the error dialog. The dialog only appears for permanent failures (403 Forbidden, user cancelled, 10 retries exhausted).

##### 4. Cloudflare Worker Rate Limiting (~17% on Proxy URLs)
- **Root cause**: The engine split files into tiny 8 MB blocks, generating ~180 parallel HTTP requests. Cloudflare Workers have strict sub-request limits; this burst triggered rate limiting at ~30 requests (~240 MB, ~17%).
- **Fix**: Block size auto-scales based on file size — 64 MB blocks for files ≥ 500 MB, 128 MB for files ≥ 2 GB. A 1.4 GB video now uses ~11 requests instead of ~180.

#### Added

##### 5. Concurrent Downloads (up to 100)
- Configurable concurrent download slots (default **6**, selectable up to **100**) in Settings → Concurrent Downloads.
- The queue automatically starts the next download as a slot frees up.
- On macOS/Linux: raised the OS open-file limit (`RLIMIT_NOFILE`) from the default 256 to 8 192 to prevent "too many open files" errors.
- On Windows: raised the CRT stdio handle limit from 512 to 2 048 via `_setmaxstdio`.

##### 6. Browser-Identical HTTP Headers
- Requests now include a standard Chrome User-Agent, `Accept: */*`, `Accept-Language`, and `Accept-Encoding: identity`. CDNs and Cloudflare Workers that previously rejected or deprioritised Flexo traffic now treat it identically to a normal browser.

#### Improved

##### 7. Cross-Platform Reliability (Windows & Linux)
- **Windows filename safety**: Strips characters illegal on NTFS/FAT (`: * ? " < > |`), trailing dots/spaces, and renames reserved device names (`CON`, `NUL`, `COM1-9`, `LPT1-9`) automatically.
- **Windows network interface detection**: Wi-Fi (`Wi-Fi`), Ethernet (`Ethernet`, `Local Area Connection`), and Hyper-V/WSL virtual adapters (`vEthernet (WSL)`) are now correctly classified.
- **Linux network interfaces**: `enp*`, `eno*`, `virbr*`, `docker*`, `tun*`, `tap*`, and VPN adapters are correctly identified.

##### 8. Probe Fallbacks
- If a server rejects a `HEAD` probe, the engine falls back to a `GET` probe and reads the first byte.
- RFC 5987 `filename*=UTF-8''...` in `Content-Disposition` is now parsed and percent-decoded to extract the correct file name.
- MIME type → file extension deduction added as a last-resort fallback.

---

## [0.2.1] - 2026-09-30


### Windows Experience Fixes & Single-Instance Stability

This release resolves critical Windows platform issues identified after installation, eliminating extraneous terminal windows, preventing duplicate system tray icons, and streamlining single-instance app execution.

#### Fixed

##### 1. Extraneous Windows Terminal Window
- **Windows GUI Subsystem**: Configured `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` in the Tauri application root (`main.rs`). Release builds on Windows now launch purely as a GUI application, preventing the operating system from allocating and displaying a superfluous console/terminal window that closed Flexo when dismissed.

##### 2. Duplicate Tray Icons & Single-Instance Enforcement
- **Single-Instance Plugin Integration**: Added `tauri-plugin-single-instance` to guarantee that only one instance of Flexo runs at any time. When launched again (via shortcuts, the installer completion screen, or browser capture requests), the existing window is seamlessly focused and brought to the front.
- **Unique Tray Identification & Creation Guard**: Assigned a persistent ID (`main-tray`) to the system tray builder and added an idempotency check (`app.tray_by_id`) to prevent duplicate icons from being registered in the taskbar.
- **Clean Tray Removal on Exit**: Explicitly remove the tray icon before exiting the application to prevent ghost/phantom icons in the Windows notification area.

##### 3. Resilient Native Messaging & Path Normalization
- **UNC Path Cleaning**: Stripped Windows `\\?\` extended-length prefixes from executable and extension folder paths when generating native messaging manifests and writing registry keys for Chrome, Edge, and Firefox.
- **Extended CLI Pattern Matching**: Enhanced browser invocation detection to recognise Edge extensions and the companion extension ID in addition to standard origin URIs, preventing native messaging calls from triggering secondary app instances.

---

## [0.2.0] - 2026-09-30

### Multi-Download Support, Native Browser Messaging & System Tray

This release upgrades Flexo with full multi-download concurrent processing, an interactive Ongoing Downloads dashboard, native browser messaging integration for rock-solid download interception, and a desktop system tray presence with background downloads.

#### Added

##### 1. Concurrent Multi-Download Manager & Ongoing Dashboard
- **Concurrent Download Engine**: Upgraded `crates/flexo-engine` to manage multiple active downloads concurrently, each maintaining its own socket-bound parallel streams, dynamic work-stealing, and speed metrics.
- **Ongoing Downloads Screen (`OngoingDownloadsScreen.tsx`)**:
  - Full-screen multi-download dashboard showing all currently active downloads with individual progress bars, chunk telemetry, speed indicators, and remaining time estimations.
  - Live aggregate throughput analytics displaying real-time combined network bandwidth.
  - Per-item controls to pause, resume, or cancel any active task independently.
- **Title Bar Ongoing Tab & Badge**:
  - Added a dedicated "Ongoing" navigation pill with real-time active download counter (`Ongoing (N)`) in the title bar.
  - Seamless navigation between the focused single-download block visualizer and the multi-download overview.
  - Automated view switching when new downloads start or when active tasks complete.

##### 2. Browser Native Messaging Integration
- **Direct Native Messaging Protocol**: Implemented standard 32-bit length-prefixed JSON messaging over stdin/stdout in `src-tauri` (`native_messaging.rs`), providing resilient link handoff without depending on local HTTP loopback bindings or encountering port conflicts.
- **Multi-Browser Support**: Compatible with Google Chrome, Microsoft Edge, Brave, and Mozilla Firefox.
- **CLI Native Host Flag**: Added `--native-messaging-host` CLI flag enabling browsers to launch and communicate directly with Flexo.
- **Automated Manifest Installer**:
  - Added `--install-native-manifest` command to write native messaging manifest files into OS-standard browser registration directories on macOS, Windows (via Windows Registry), and Linux.
  - Added a one-click "Install Native Messaging Host" button in the Settings screen.
- **Extension Update (v0.2.0)**:
  - Updated `extensions/browser` to connect to Flexo via Native Messaging first, with automatic fallback to HTTP capture (`127.0.0.1:17890`).

##### 3. Desktop System Tray & Background Downloads
- **System Tray Presence**: Native system tray icon displaying active download counts and combined speeds.
- **Context Tray Menu**: Quick-access menu offering "Show Flexo", "Hide Flexo", and "Quit Flexo".
- **Background Mode**: Closing or minimizing the main window automatically minimizes to the system tray, allowing ongoing downloads to complete uninterrupted in the background.

#### Changed
- Idle screen now displays an "Ongoing Downloads" quick-switch button when background tasks are running.
- Zustand store (`useAppStore.ts`) expanded to track all active tasks, global aggregate metrics, and active task selections.
- Improved clipboard URL auto-detection and validation.

#### Fixed
- Fixed task state transitions when downloads complete while multiple tasks are in flight.
- Cleaned up socket allocations when cancelling individual active downloads.

---

## [0.1.0] - 2026-09-30

### Initial Release

Flexo is a high-performance multi-network download manager for desktop platforms (macOS, Windows, Linux). Flexo splits file downloads into byte ranges and fetches them simultaneously across multiple physical and virtual network interfaces (Wi-Fi, Ethernet, USB tethering, Cellular), combining bandwidth with adaptive scheduling, speculative hedging, and automatic failover.

#### Features Added

##### 1. Core Multi-Network Engine (`crates/flexo-engine`)

- **Multi-Interface Socket Binding**: Direct socket assignment (`socket2`) binding HTTP requests to specific local IP addresses and network interfaces (Wi-Fi, Ethernet, USB cellular modems).
- **Dynamic Work-Stealing Scheduler**: Real-time throughput estimation dynamically distributes byte ranges to the fastest available interfaces, continuously reallocating chunks as connection speeds fluctuate.
- **Speculative Hedging**: Automatically spawns redundant requests across alternate interfaces when a chunk's transfer stalls or lags significantly behind peers, minimizing tail latency.
- **Granular Segment Presets**: Customizable block sizing with presets for Auto, 8 MB, 16 MB, 32 MB, and 64 MB chunks to match network latency and file size.
- **Concurrent Mirror Sourcing**: Slices workloads across multiple mirror URLs in parallel with automatic fallback if an endpoint fails or throttles.
- **Media Stream Extraction**: Built-in support for Progressive HTTP downloads, Clear HLS playlists (`.m3u8`), and Clear DASH manifests (`.mpd`), with optional `yt-dlp` and `ffmpeg` integration for page scraping and remuxing.
- **BitTorrent & Magnet Subsystem**: Native magnet URI parsing and info hash extraction ready for librqbit torrent streaming (`--features torrent`).

##### 2. Tauri 2 Desktop Host (`src-tauri`)

- **Tauri v2 Desktop Architecture**: Low-footprint native host running on macOS, Windows, and Linux.
- **Local Capture Server**: Lightweight embedded HTTP server listening on `127.0.0.1:17890` for receiving download requests directly from browser extensions or CLI tools.
- **Custom Deep Link Protocol**: Registered `flexo://` protocol handler allowing seamless one-click link handoff from web browsers and desktop shortcuts.
- **Embedded SQLite Persistence**: Powered by `rusqlite` to store download history, active tasks, session state, and user preferences locally.
- **Desktop Integrations**: Native window styling (frameless custom titlebar), system tray icon with status menu, OS notifications, and clipboard monitoring.

##### 3. React 19 Frontend (`src/renderer`)

- **Modern UI Stack**: Built on React 19, Vite 7, Tailwind CSS v4, and Zustand state management.
- **Real-Time Block Grid**: Interactive visualizer showing live chunk downloading progress color-coded by the active network interface.
- **Throughput Analytics**: Live throughput graph displaying per-connection and aggregated bandwidth speeds over time.
- **Multi-Network Interface Dashboard**: Interface list with active/inactive toggles, latency pings, transfer statistics, and speed badges.
- **Queue & Media Sheets**: Interactive drawer sheets to inspect queued downloads, adjust priorities, and select audio/video stream candidates.
- **Adaptive Appearance**: First-class dark and light themes with custom variable fonts (`Manrope` and `Roboto Mono`).
- **DevTools Panel**: In-app simulator for testing multi-network chunking, throttling, and fault recovery without external network dependencies.

##### 4. Companion Extensions & Widgets

- **Browser Extension (`extensions/browser`)**: Manifest v3 extension for Chrome, Edge, and Chromium-based browsers for intercepting downloads and passing them to Flexo.
- **macOS WidgetKit (`widgets/macos`)**: Native Swift WidgetKit extension displaying real-time download activity in macOS Notification Center.
- **Windows Adaptive Cards (`widgets/windows`)**: Adaptive Card template for Windows Widgets and desktop notification dashboards.
