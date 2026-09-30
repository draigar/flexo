# Flexo v0.2.0 — Concurrent Downloads, Native Messaging & System Tray

Flexo v0.2.0 is a major feature update that introduces **multiple concurrent downloads** with a dedicated **Ongoing Downloads dashboard**, **Native Messaging browser integration** for seamless capture from Chrome, Edge, Firefox, and Brave, and **desktop system tray support** allowing downloads to continue uninterrupted in the background.

---

## What's New in v0.2.0

### 🚀 Simultaneous Multi-Download Manager & Ongoing Dashboard
- **Concurrent Download Engine**: Flexo can now actively download multiple files in parallel, each running its own multi-interface socket bindings, dynamic work-stealing, and speculative hedging.
- **Dedicated Ongoing Dashboard**: Switch instantly to the new `OngoingDownloadsScreen` to view real-time progress bars, chunk telemetry, speed indicators, ETAs, and individual pause/resume/cancel controls for every active task.
- **Combined Bandwidth Telemetry**: Live aggregate throughput graph displaying the combined speed across all network adapters and active downloads.
- **Header Navigation Pill**: Title bar features an `Ongoing (N)` badge to quickly jump between the single-download block visualizer and the multi-download overview.

### 🌐 Browser Native Messaging Integration
- **Direct Protocol Handoff**: Standard length-prefixed JSON messaging over stdin/stdout eliminates dependency on HTTP loopback server availability or local port conflicts.
- **Multi-Browser Compatibility**: Supports Google Chrome, Microsoft Edge, Brave, and Mozilla Firefox.
- **One-Click Native Host Installer**: Install the native messaging manifest directly from the Settings screen or via the CLI flag:
  ```bash
  flexo --install-native-manifest
  ```
- **Browser Extension v0.2.0**: The companion extension now attempts Native Messaging first for instant, reliable link interception, with automatic fallback to the local HTTP capture server (`127.0.0.1:17890`).

### 🖥️ Desktop System Tray & Background Downloads
- **Live Tray Icon**: Displays active download count and real-time aggregate speed in the system menu bar / notification area.
- **Background Mode**: Closing or minimizing the main window docks Flexo to the tray so large multi-network transfers continue in the background without risk of accidental termination.
- **Quick Tray Menu**: Easily toggle window visibility or quit cleanly from the tray context menu.

---

## Getting Started

### Installation Assets (v0.2.0)

Download the installer or binary for your operating system from the GitHub Release assets:

- **macOS**: `Flexo_0.2.0_universal.dmg` (supports both Apple Silicon and Intel)
- **Windows**: `Flexo_0.2.0_x64-setup.exe` or `Flexo_0.2.0_x64.msi`
- **Linux**: `flexo_0.2.0_amd64.deb` or `Flexo_0.2.0_amd64.AppImage`

### Run from Source

```bash
# Clone the repository
git clone https://github.com/draigar/flexo.git
cd flexo

# Install dependencies and launch
npm install
npm run tauri:dev
```

---

## Full Changelog

For the complete list of commits and changes across all releases, see [CHANGELOG.md](./CHANGELOG.md).
