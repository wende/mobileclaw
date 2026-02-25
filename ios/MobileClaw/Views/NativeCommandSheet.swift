import SwiftUI

struct CommandItem: Identifiable {
    let id = UUID()
    let name: String
    let description: String
    let group: String
}

private let commands: [CommandItem] = [
    // Session
    CommandItem(name: "/new", description: "Start a new session", group: "Session"),
    CommandItem(name: "/compact", description: "Compact conversation history", group: "Session"),
    CommandItem(name: "/clear", description: "Clear the chat display", group: "Session"),
    // Options
    CommandItem(name: "/model", description: "Switch the AI model", group: "Options"),
    CommandItem(name: "/system", description: "Set system prompt", group: "Options"),
    CommandItem(name: "/temperature", description: "Set temperature", group: "Options"),
    // Status
    CommandItem(name: "/status", description: "Show connection status", group: "Status"),
    CommandItem(name: "/usage", description: "Show token usage", group: "Status"),
    CommandItem(name: "/sessions", description: "List sessions", group: "Status"),
    // Skills
    CommandItem(name: "/search", description: "Web search", group: "Skills"),
    CommandItem(name: "/image", description: "Generate an image", group: "Skills"),
    CommandItem(name: "/code", description: "Execute code", group: "Skills"),
]

struct NativeCommandSheet: View {
    let onSelect: (String) -> Void
    @State private var search: String = ""
    @Environment(\.dismiss) private var dismiss

    private var filtered: [CommandItem] {
        if search.isEmpty { return commands }
        let query = search.lowercased()
        return commands.filter {
            $0.name.lowercased().contains(query) || $0.description.lowercased().contains(query)
        }
    }

    private var grouped: [(String, [CommandItem])] {
        let groups = Dictionary(grouping: filtered) { $0.group }
        let order = ["Session", "Options", "Status", "Skills"]
        return order.compactMap { key in
            guard let items = groups[key] else { return nil }
            return (key, items)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(grouped, id: \.0) { group, items in
                    Section(group) {
                        ForEach(items) { item in
                            Button {
                                onSelect(item.name)
                                dismiss()
                            } label: {
                                HStack(spacing: 12) {
                                    Text(item.name)
                                        .font(.system(.callout, design: .monospaced))
                                        .fontWeight(.medium)
                                        .foregroundStyle(.primary)

                                    Text(item.description)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)

                                    Spacer()
                                }
                            }
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: "Search commands...")
            .navigationTitle("Commands")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
