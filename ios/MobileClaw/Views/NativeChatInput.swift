import SwiftUI

struct NativeChatInput: View {
    let onSend: (String, [ImageAttachmentData]?) -> Void
    let onAbort: () -> Void
    let onScrollToBottom: () -> Void
    let isRunActive: Bool
    let hasQueued: Bool
    let scrollDistance: CGFloat
    @Binding var quoteText: String?
    @Binding var draft: String

    @FocusState private var isFocused: Bool

    private var trimmedDraft: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // Morph progress: 0 = at bottom (input mode), 1 = scrolled up (pill mode)
    // 30px deadzone ignores small bounces from auto-scroll during streaming
    private var sp: CGFloat {
        let threshold: CGFloat = 30
        return min(1, max(0, (scrollDistance - threshold) / 60))
    }

    // Layout progress with deadzone
    private var lp: CGFloat {
        sp < 0.05 ? 0 : (sp - 0.05) / 0.95
    }

    private var sideOpacity: CGFloat {
        max(0, 1 - sp * 2.5)
    }

    private var sideSize: CGFloat {
        40 * (1 - lp)
    }

    // Horizontal padding morphs: 12 at sp=0 → centers a ~190px pill at sp=1
    private var morphPadding: CGFloat {
        let screenWidth = UIScreen.main.bounds.width
        let pillWidth: CGFloat = 190
        let basePad: CGFloat = 12
        let pillPad = (screenWidth - pillWidth) / 2
        return basePad + lp * (pillPad - basePad)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Quote preview
            if let quote = quoteText, sp < 0.3 {
                HStack(spacing: 6) {
                    Image(systemName: "quote.opening")
                        .font(.system(size: 10))
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
                            .font(.system(size: 12))
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                )
                .padding(.horizontal, 12)
                .padding(.bottom, 4)
                .opacity(Double(1 - sp * 3))
            }

            // Morphing input bar → pill
            HStack(alignment: .bottom, spacing: 8 * (1 - lp)) {
                // Attach button — shrinks and fades
                Button {
                    // Photo picker
                } label: {
                    Image(systemName: "paperclip")
                        .font(.system(size: 17))
                        .foregroundStyle(Color(.label).opacity(0.6))
                        .frame(width: sideSize, height: sideSize)
                        .background(
                            Circle()
                                .fill(Color(.systemBackground).opacity(0.8))
                        )
                        .overlay(
                            Circle()
                                .strokeBorder(Color(.separator).opacity(0.4), lineWidth: 0.5)
                        )
                }
                .opacity(sideOpacity)
                .allowsHitTesting(sp < 0.4)

                // Center glass shape — morphs from wide input to compact pill
                ZStack {
                    // TextField — fades out
                    TextField(
                        isRunActive
                            ? (hasQueued ? "Replace queued message..." : "Queue a message...")
                            : "Send a message...",
                        text: $draft,
                        axis: .vertical
                    )
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .focused($isFocused)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .contentShape(Rectangle().inset(by: -10))
                    .opacity(1 - sp)
                    .allowsHitTesting(sp < 0.4)
                    .onSubmit { submit() }

                    // "Scroll to bottom" — fades in
                    Button {
                        onScrollToBottom()
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "chevron.down")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Color(.label).opacity(0.85))
                            Text("Scroll to bottom")
                                .font(.subheadline)
                                .foregroundStyle(Color(.label).opacity(0.85))
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                    }
                    .opacity(sp)
                    .allowsHitTesting(sp >= 0.4)
                }
                .background(
                    RoundedRectangle(cornerRadius: 20 + lp * 4)
                        .fill(.ultraThinMaterial)
                        .shadow(color: .black.opacity(0.06), radius: 3, y: 2)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 20 + lp * 4)
                        .strokeBorder(Color(.separator).opacity(0.3), lineWidth: 0.5)
                )

                // Send / Stop / Queue — shrinks and fades
                Button {
                    if isRunActive && trimmedDraft.isEmpty {
                        onAbort()
                    } else {
                        submit()
                    }
                } label: {
                    ZStack {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(.red.opacity(0.6))
                            .frame(width: sideSize, height: sideSize)
                            .background(
                                Circle()
                                    .fill(Color.red.opacity(0.05))
                                    .strokeBorder(Color.red.opacity(0.3), lineWidth: 1)
                            )
                            .opacity(isRunActive && trimmedDraft.isEmpty ? 1 : 0)

                        Image(systemName: "text.append")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                            .frame(width: sideSize, height: sideSize)
                            .background(
                                Circle()
                                    .fill(Color(.secondarySystemBackground))
                                    .strokeBorder(Color(.separator).opacity(0.4), lineWidth: 1)
                            )
                            .opacity(isRunActive && !trimmedDraft.isEmpty && !hasQueued ? 1 : 0)

                        Image(systemName: "arrow.up")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: sideSize, height: sideSize)
                            .background(
                                Circle()
                                    .fill(trimmedDraft.isEmpty && !isRunActive
                                          ? Color(.label).opacity(0.3)
                                          : Color(.label))
                            )
                            .opacity(!isRunActive || (isRunActive && !trimmedDraft.isEmpty && hasQueued) ? 1 : 0)
                    }
                    .animation(.easeInOut(duration: 0.2), value: isRunActive)
                    .animation(.easeInOut(duration: 0.2), value: trimmedDraft.isEmpty)
                }
                .disabled(trimmedDraft.isEmpty && !isRunActive)
                .opacity(sideOpacity)
                .allowsHitTesting(sp < 0.4)
            }
            .padding(.horizontal, morphPadding)
            .padding(.vertical, 8)
            .animation(.interactiveSpring(duration: 0.3), value: sp)
        }
    }

    private func submit() {
        let text = trimmedDraft
        guard !text.isEmpty else { return }

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
