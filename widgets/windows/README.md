# Flexo Windows Widget

Windows 11 Widgets Board provider that reads the same `widget-snapshot.json` the engine
writes, and renders an Adaptive Card with file name, percent, and an Open action that
launches `flexo://download/<id>`.

## Integration

1. Package Flexo as MSIX (Tauri bundle).
2. Register a widget provider package that watches:

```text
%LOCALAPPDATA%\com.flexo.app\widget-snapshot.json
```

3. Feed the Adaptive Card template in `adaptive-card.json` from that snapshot.
4. Also set taskbar progress on the main window while a download is active (supported
   directly from the Tauri host).

See `adaptive-card.json` for the card body.
