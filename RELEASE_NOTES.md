# Flexo v0.2.1 — Windows Experience & Single-Instance Stability Update

Flexo v0.2.1 addresses post-installation feedback on Windows, resolving unwanted console/terminal windows, preventing duplicate system tray icons, and enforcing single-instance application lifecycle management.

---

## What's Changed in v0.2.1

### 🪟 Windows Console / Terminal Window Resolved
- **GUI Subsystem Configuration**: Configured `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` in the application binary root (`src-tauri/src/main.rs`). Installed release builds now execute strictly as Windows GUI applications without opening a command prompt or terminal window. Closing or interacting with Windows command prompts will no longer terminate the background application.

### 📌 Duplicate Tray Icons & Single-Instance Enforcement
- **Single-Instance Plugin**: Registered `tauri-plugin-single-instance` to prevent duplicate app processes. If Flexo is launched a second time (e.g. from the installer finish page, desktop shortcut, or browser capture event), the existing app window is brought to focus, avoiding duplicate instances and multiple tray icons.
- **Idempotent Tray Registration**: Tray builder now uses a unique ID (`main-tray`) with an active existence check to ensure only a single system tray icon is ever registered.
- **Clean Tray Destruction**: The system tray icon is explicitly removed on exit so no lingering phantom icons remain in the Windows taskbar.

### 🌐 Native Messaging & Windows Path Normalization
- **UNC Path Cleaning**: Path references used in Windows registry entries and native messaging manifests are now stripped of Windows `\\?\` prefix, ensuring browsers execute the background helper cleanly.
- **Broadened Browser Protocol Matching**: Extension detection now covers Edge extension protocols and extension ID parameters, guaranteeing that browser messages route directly through native messaging rather than triggering new application windows.

---

## Getting Started

### Installation Assets (v0.2.1)

Download the installer or binary for your operating system from the GitHub Release assets:

- **macOS**: `Flexo_0.2.1_universal.dmg` (Apple Silicon & Intel)
- **Windows**: `Flexo_0.2.1_x64-setup.exe` or `Flexo_0.2.1_x64.msi`
- **Linux**: `flexo_0.2.1_amd64.deb` or `Flexo_0.2.1_amd64.AppImage`

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
