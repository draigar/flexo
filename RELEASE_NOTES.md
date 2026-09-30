# Flexo v0.1.0 — Initial Release

Flexo is an open-source, high-performance desktop download manager built with **Rust** (`crates/flexo-engine`), **Tauri 2**, and **React 19**. It aggregates multiple network connections (Wi-Fi, Ethernet, USB cellular modems, tethering) in parallel to maximize download speeds through intelligent byte-range chunking.

---

## Highlights

- 🚀 **Multi-Interface Parallel Aggregation**: Combine your home Wi-Fi, phone's USB hotspot, and Ethernet concurrently.
- 🧠 **Dynamic Work-Stealing & Speculative Hedging**: Fast connections claim more work; lagging blocks are automatically hedged on idle interfaces to eliminate long tails.
- 📊 **Visual Block Grid & Live Throughput**: Watch your download progress block-by-block with color coding mapped to each active network interface.
- 🌐 **Browser Extension & Local Capture**: One-click download interception from Chrome and Edge via embedded capture server (`127.0.0.1:17890`).
- 🎬 **Stream & Media Capture**: Automatic extraction and remuxing for Progressive HTTP, Clear HLS, and Clear DASH streams via `yt-dlp` and `ffmpeg`.
- 🗄️ **Local SQLite Database**: Embedded history and persistent state with pause and resume support.
- 🔗 **Deep Linking & Desktop Widgets**: Integrated with `flexo://` URI scheme, macOS WidgetKit, and Windows Adaptive Cards.

---

## Getting Started

### Installation

Download the installer for your platform from the release assets:

- **macOS**: `Flexo_0.1.0_universal.dmg` or `Flexo_0.1.0_aarch64.dmg` / `Flexo_0.1.0_x64.dmg`
- **Windows**: `Flexo_0.1.0_x64-setup.exe` or `Flexo_0.1.0_x64.msi`
- **Linux**: `flexo_0.1.0_amd64.deb` or `Flexo_0.1.0_amd64.AppImage`

### Run from Source

```bash
# Clone the repository
git clone https://github.com/draigar/flexo.git
cd flexo

# Install frontend dependencies
npm install

# Run in development mode
npm run tauri:dev
```

---

## Full Changelog

See [CHANGELOG.md](./CHANGELOG.md) for detailed release history.
