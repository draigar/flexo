# Changelog

All notable changes to Flexo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
