# Flexo macOS Widget

WidgetKit extension that reads `widget-snapshot.json` from the Flexo App Group container
(`group.com.flexo.app`) and opens `flexo://download/<id>` on tap.

## Files to add in Xcode

Create an App Extension target named `FlexoWidget` inside the Flexo `.app` bundle, enable
App Groups `group.com.flexo.app`, then drop these sources into the target.

The Rust engine writes the snapshot via `Engine::write_snapshot()` to:

```text
~/Library/Group Containers/group.com.flexo.app/widget-snapshot.json
```

(or the path configured in `src-tauri` / engine data dir bridged into the group container).

## Snapshot shape

```json
{
  "current": { "id": "...", "fileName": "...", "status": "downloading", "bytesDownloaded": 1, "totalBytes": 2 },
  "queue": [],
  "writtenAt": 0
}
```

See `FlexoWidget.swift` for the WidgetKit timeline provider and deep-link App Intent.
