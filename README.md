# Flexo

A fast multi-network download manager. Flexo splits a file into byte ranges and downloads them in parallel across Wi-Fi, Ethernet, USB tethering, and cellular — then adds a queue, mirrors, media capture, torrents, and desktop widgets.

Flexo is a new project next to [Plexo](https://github.com/anmolkapil/plexo). The React window is adapted from Plexo; the engine is Rust behind Tauri.

## Stack

- **UI** — React 19, Tailwind CSS v4, Zustand
- **Host** — Tauri 2 (`src-tauri/`) with System Tray & Native Messaging host
- **Engine** — `crates/flexo-engine` (HTTP ranges, multi-download concurrent manager, work-stealing, hedges, mirrors, media, torrents)
- **Bridge** — `window.flexo` via `@tauri-apps/api`
- **Browser extension** — `extensions/browser` (Native Messaging host with automatic manifest registration + HTTP capture fallback on `127.0.0.1:17890`)
- **System Tray** — Background minimization, live download speed indicator, and tray menu
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

| Area                                          | Status                                                         |
| --------------------------------------------- | -------------------------------------------------------------- |
| Multi-interface HTTP range downloads          | Engine + UI (Work-stealing & speculative hedging)              |
| Multiple concurrent active downloads          | Engine + Ongoing Downloads Dashboard                           |
| Segment presets (Auto / 8 / 16 / 32 / 64 MB)  | Engine + Idle screen                                           |
| Waiting queue + clipboard URL handoff         | Engine + Tauri + UI                                            |
| Browser capture (Native Messaging & HTTP)     | `extensions/browser` + Native host installer + HTTP fallback   |
| System tray & background mode                 | Tauri tray icon + background minimization on close             |
| Progressive / clear HLS / clear DASH / yt-dlp | Engine + media sheet (DRM refused)                             |
| HTTP mirrors                                  | Engine + Idle screen                                           |
| Magnets / `.torrent`                          | Accepted into the engine; librqbit behind `--features torrent` |
| `flexo://` deep links + widget snapshot       | Tauri + `widgets/*`                                            |

## Layout

```text
src/renderer/          React window, Ongoing Downloads, Block visualizer, Settings
src/shared/            Types, plan, IPC contract
src/bridge/            window.flexo Tauri client
src-tauri/             Tauri host, tray, native messaging, deep links, capture server
crates/flexo-engine/   Download engine (multi-download manager, scheduler, socket2)
extensions/browser/    Chrome/Edge/Firefox capture extension (Native Messaging + HTTP)
widgets/macos/         WidgetKit sources
widgets/windows/       Adaptive Card template
```

## Releases & Versioning

- Detailed version history: [CHANGELOG.md](./CHANGELOG.md)
- Release notes: [RELEASE_NOTES.md](./RELEASE_NOTES.md)
- Release & automated build workflows guide: [docs/RELEASING.md](./docs/RELEASING.md)

To bump version across all crates and packages:

```bash
npm run release:patch  # 0.2.0 -> 0.2.1
npm run release:minor  # 0.2.0 -> 0.3.0
```

## License

MIT
