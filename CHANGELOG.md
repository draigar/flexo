# Changelog

All notable changes to Flexo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
