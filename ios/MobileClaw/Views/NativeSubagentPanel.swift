import SwiftUI

struct NativeSubagentPanel: View {
    let taskName: String
    let model: String?
    let onUnpin: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "cpu")
                .font(.caption)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 2) {
                Text(taskName)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(1)

                if let model {
                    Text(model)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            Button {
                onUnpin()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
    }
}
