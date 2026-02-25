import SwiftUI

struct NativeQueuePill: View {
    let text: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.right")
                .font(.caption2)
                .foregroundStyle(.tertiary)

            Text("Queued")
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)

            Text(text)
                .font(.caption)
                .foregroundStyle(.tertiary)
                .lineLimit(1)

            Spacer()

            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption2)
                    .foregroundStyle(.quaternary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
                .strokeBorder(.quaternary, lineWidth: 0.5)
        )
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
        .transition(.asymmetric(
            insertion: .push(from: .bottom).combined(with: .opacity),
            removal: .push(from: .top).combined(with: .opacity)
        ))
    }
}
