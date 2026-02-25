import SwiftUI

struct NativeChatInput: View {
    let onSend: (String, [ImageAttachmentData]?) -> Void
    let onAbort: () -> Void
    let isRunActive: Bool
    let hasQueued: Bool
    @Binding var quoteText: String?
    @Binding var draft: String

    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Quote preview
            if let quote = quoteText {
                HStack(spacing: 8) {
                    Image(systemName: "quote.opening")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    Text(quote)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)

                    Spacer()

                    Button {
                        quoteText = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(.ultraThinMaterial)
            }

            // Input row
            HStack(alignment: .bottom, spacing: 8) {
                // Attach button
                Button {
                    // Photo picker would go here
                } label: {
                    Image(systemName: "paperclip")
                        .font(.system(size: 18))
                        .foregroundStyle(.secondary)
                        .frame(width: 40, height: 40)
                }

                // Text editor
                TextField("Send a message...", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .focused($isFocused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(.regularMaterial)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 20)
                            .strokeBorder(.quaternary, lineWidth: 0.5)
                    )
                    .onSubmit {
                        submit()
                    }

                // Send / Stop / Queue button
                Button {
                    if isRunActive && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        onAbort()
                    } else {
                        submit()
                    }
                } label: {
                    Group {
                        if isRunActive && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            // Stop button
                            Image(systemName: "stop.fill")
                                .font(.system(size: 14))
                                .foregroundStyle(.red)
                                .frame(width: 36, height: 36)
                                .background(
                                    Circle()
                                        .fill(Color.red.opacity(0.1))
                                        .strokeBorder(Color.red.opacity(0.3), lineWidth: 1)
                                )
                        } else if isRunActive && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !hasQueued {
                            // Queue button
                            Image(systemName: "text.append")
                                .font(.system(size: 14))
                                .foregroundStyle(.secondary)
                                .frame(width: 36, height: 36)
                                .background(
                                    Circle()
                                        .fill(.regularMaterial)
                                        .strokeBorder(.quaternary, lineWidth: 1)
                                )
                        } else {
                            // Send button
                            Image(systemName: "arrow.up")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(width: 36, height: 36)
                                .background(
                                    Circle()
                                        .fill(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isRunActive
                                              ? Color.primary.opacity(0.3)
                                              : Color.primary)
                                )
                        }
                    }
                }
                .disabled(
                    draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    && !isRunActive
                )
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        // Prepend quote if present
        var message = text
        if let quote = quoteText {
            let quoted = quote.split(separator: "\n").map { "> \($0)" }.joined(separator: "\n")
            message = "\(quoted)\n\n\n\(text)"
            quoteText = nil
        }

        onSend(message, nil)
        draft = ""
    }
}
