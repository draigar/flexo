# Flexo

A fast multi-network download manager. Flexo splits a file into byte ranges and downloads them in parallel across Wi-Fi, Ethernet, USB tethering, and cellular — then adds a queue, mirrors, media capture, torrents, and desktop widgets.

Flexo is a new project next to [Plexo](https://github.com/anmolkapil/plexo). The React window is adapted from Plexo; the engine is Rust behind Tauri.

## Stack

- **UI** — React 19, Tailwind CSS v4, Zustand (copied from Plexo)
- **Host** — Tauri 2 (`src-tauri/`)
- **Engine** — `crates/flexo-engine` (HTTP ranges, work-stealing, hedges, mirrors, media, torrents)
- **Bridge** — `window.flexo` via `@tauri-apps/api`
- **Browser extension** — `extensions/browser` posts captures to `127.0.0.1:17890`
- **Widgets** — `widgets/macos` (WidgetKit) and `widgets/windows` (Adaptive Card)

## Requirements

- Node.js 22+
- Rust stable (1.77+)
- [Tauri system deps](https://v2.tauri.app/start/prerequisites/)
- Optional: `yt-dlp` and `ffmpeg` on PATH for page/media extraction and remux
- Optional: build with `--features torrent` once librqbit wiring is enabled

## Develop

```bash
npm install
npm run tauri:dev
```

Engine tests:

```bash
cargo test -p flexo-engine
```

## Features

| Area | Status |
|---|---|
| Multi-interface HTTP range downloads | Engine + UI |
| Segment presets (Auto / 8 / 16 / 32 / 64 MB) | Engine + Idle screen |
| Waiting queue + clipboard URL handoff | Engine + Tauri + UI |
| Browser capture extension | `extensions/browser` |
| Progressive / clear HLS / clear DASH / yt-dlp | Engine + media sheet (DRM refused) |
| HTTP mirrors | Engine + Idle screen |
| Magnets / `.torrent` | Accepted into the engine; librqbit behind `--features torrent` |
| `flexo://` deep links + widget snapshot | Tauri + `widgets/*` |

## Layout

```text
src/renderer/          React window
src/shared/            Types, plan, IPC contract
src/bridge/            window.flexo Tauri client
src-tauri/             Tauri host, tray, deep links, capture server
crates/flexo-engine/   Download engine
extensions/browser/    Chrome/Edge capture extension
widgets/macos/         WidgetKit sources
widgets/windows/       Adaptive Card template
```

## License

MIT
