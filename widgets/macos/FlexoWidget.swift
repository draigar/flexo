import AppIntents
import SwiftUI
import WidgetKit

struct FlexoSnapshot: Codable {
  struct Download: Codable {
    var id: String
    var fileName: String
    var status: String
    var bytesDownloaded: UInt64
    var totalBytes: UInt64
  }

  var current: Download?
  var writtenAt: UInt64
}

struct FlexoEntry: TimelineEntry {
  let date: Date
  let snapshot: FlexoSnapshot?
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> FlexoEntry {
    FlexoEntry(date: Date(), snapshot: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (FlexoEntry) -> Void) {
    completion(FlexoEntry(date: Date(), snapshot: loadSnapshot()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<FlexoEntry>) -> Void) {
    let entry = FlexoEntry(date: Date(), snapshot: loadSnapshot())
    completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(60))))
  }

  private func loadSnapshot() -> FlexoSnapshot? {
    guard let url = FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: "group.com.flexo.app")?
      .appendingPathComponent("widget-snapshot.json"),
      let data = try? Data(contentsOf: url)
    else { return nil }
    return try? JSONDecoder().decode(FlexoSnapshot.self, from: data)
  }
}

struct FlexoWidgetView: View {
  var entry: Provider.Entry

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("FLEXO")
        .font(.system(.caption2, design: .monospaced))
        .foregroundStyle(.secondary)
      if let current = entry.snapshot?.current {
        Text(current.fileName)
          .font(.system(.headline, design: .monospaced))
          .lineLimit(1)
        Text(statusLine(current))
          .font(.system(.caption, design: .monospaced))
          .foregroundStyle(.secondary)
      } else {
        Text("No active download")
          .font(.system(.body, design: .monospaced))
      }
    }
    .containerBackground(.fill.tertiary, for: .widget)
    .widgetURL(URL(string: entry.snapshot?.current.map { "flexo://download/\($0.id)" } ?? "flexo://"))
  }

  private func statusLine(_ download: FlexoSnapshot.Download) -> String {
    guard download.totalBytes > 0 else { return download.status }
    let pct = Int((Double(download.bytesDownloaded) / Double(download.totalBytes)) * 100)
    return "\(download.status) · \(pct)%"
  }
}

struct FlexoWidget: Widget {
  let kind = "FlexoWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      FlexoWidgetView(entry: entry)
    }
    .configurationDisplayName("Flexo")
    .description("Glance at the active Flexo download.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct OpenFlexoIntent: AppIntent {
  static var title: LocalizedStringResource = "Open Flexo"

  func perform() async throws -> some IntentResult {
    // Deep link handled by the host app.
    .result()
  }
}
