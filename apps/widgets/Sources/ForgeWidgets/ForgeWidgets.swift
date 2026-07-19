import SwiftUI
import WidgetKit

/// `35a` desktop widgets: glanceable task state. Data comes from the local
/// runtime's loopback HTTP API via the shared snapshot the app writes (no
/// App Group entitlement needed for the hand-assembled experiment).
struct ForgeEntry: TimelineEntry {
    let date: Date
    let running: Int
    let waiting: Int
    let title: String
}

struct ForgeProvider: TimelineProvider {
    func placeholder(in context: Context) -> ForgeEntry {
        ForgeEntry(date: .now, running: 1, waiting: 1, title: "Add retry backoff")
    }

    func getSnapshot(in context: Context, completion: @escaping (ForgeEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ForgeEntry>) -> Void) {
        completion(Timeline(entries: [loadEntry()], policy: .after(.now.addingTimeInterval(60))))
    }

    private func loadEntry() -> ForgeEntry {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: "/tmp/forge-widget-snapshot.json")),
              let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data)
        else {
            return ForgeEntry(date: .now, running: 0, waiting: 0, title: "Open Forge to start a task")
        }
        return ForgeEntry(date: .now, running: snapshot.running, waiting: snapshot.waiting, title: snapshot.title)
    }

    struct Snapshot: Decodable {
        let running: Int
        let waiting: Int
        let title: String
    }
}

struct ForgeWidgetView: View {
    var entry: ForgeEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("FORGE")
                    .font(.system(size: 11, weight: .heavy, design: .monospaced))
                Spacer()
                Circle()
                    .fill(entry.running > 0 ? Color.purple : Color.gray)
                    .frame(width: 7, height: 7)
            }
            Text(entry.title)
                .font(.system(size: 13, weight: .bold))
                .lineLimit(2)
            Spacer()
            Text("\(entry.running) running · \(entry.waiting) needs you")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .containerBackground(.background, for: .widget)
    }
}

struct ForgeStatusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ForgeStatus", provider: ForgeProvider()) { entry in
            ForgeWidgetView(entry: entry)
        }
        .configurationDisplayName("Forge Tasks")
        .description("Running agents and tasks that need you.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct ForgeWidgetBundle: WidgetBundle {
    var body: some Widget {
        ForgeStatusWidget()
    }
}
