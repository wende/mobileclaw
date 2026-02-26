import SwiftUI

struct NativeChatHeader: View {
    let currentModel: String?
    let connectionState: ConnectionState
    let backendMode: BackendMode
    let sessionName: String
    let sessionSwitching: Bool
    let isSessionDropdownOpen: Bool
    let onOpenSetup: () -> Void
    let onToggleSessionDropdown: () -> Void

    var body: some View {
        ZStack {
            HStack(spacing: 12) {
                // Logo / setup button
                Button(action: onOpenSetup) {
                    logoView(size: 36, imageSize: 34)
                }

                Spacer()

                // Connection status dot
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                    .overlay {
                        if connectionState == .connecting || connectionState == .reconnecting {
                            Circle()
                                .strokeBorder(statusColor.opacity(0.5), lineWidth: 2)
                                .frame(width: 14, height: 14)
                                .modifier(PulseModifier())
                        }
                    }
            }

            VStack(spacing: 2) {
                if backendMode == .openclaw {
                    Button(action: onToggleSessionDropdown) {
                        HStack(spacing: 4) {
                            Text(sessionName)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)

                            if sessionSwitching {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 9, weight: .semibold))
                                    .foregroundStyle(.secondary)
                                    .rotationEffect(.degrees(isSessionDropdownOpen ? 180 : 0))
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text("MobileClaw")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let currentModel, !currentModel.isEmpty {
                    Text(currentModel)
                        .font(.caption2)
                        .foregroundStyle(.secondary.opacity(0.8))
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: 220)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private func logoView(size: CGFloat, imageSize: CGFloat) -> some View {
        if #available(iOS 26.0, *) {
            Image("Logo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: imageSize, height: imageSize)
                .frame(width: size, height: size)
                .glassEffect(.regular, in: .circle)
        } else {
            Image("Logo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: imageSize, height: imageSize)
                .frame(width: size, height: size)
                .background(
                    Circle()
                        .fill(.white)
                        .frame(width: size, height: size)
                        .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
                )
                .clipShape(Circle())
        }
    }

    private var statusColor: Color {
        switch connectionState {
        case .connected: .green
        case .connecting, .reconnecting: .yellow
        case .disconnected: .gray
        case .error: .red
        }
    }
}

struct PulseModifier: ViewModifier {
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(isPulsing ? 1.5 : 1.0)
            .opacity(isPulsing ? 0 : 1)
            .animation(.easeInOut(duration: 1).repeatForever(autoreverses: false), value: isPulsing)
            .onAppear { isPulsing = true }
    }
}

struct NativeSessionDropdown: View {
    let sessions: [SessionInfo]
    let loading: Bool
    let currentSessionKey: String
    let sessionSwitching: Bool
    let onRefresh: () -> Void
    let onSelect: (String) -> Void
    let onDismiss: () -> Void

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.opacity(0.001)
                .ignoresSafeArea()
                .onTapGesture { onDismiss() }

            VStack(spacing: 10) {
                HStack(spacing: 8) {
                    Text("Sessions")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)

                    Spacer()

                    Button(action: onRefresh) {
                        Group {
                            if loading {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 13, weight: .semibold))
                            }
                        }
                        .frame(width: 30, height: 30)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }

                if loading && sessions.isEmpty {
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Loading sessions...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 70)
                } else if sessions.isEmpty {
                    Text("No sessions found")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 70)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 4) {
                            ForEach(sessions) { session in
                                sessionRow(session)
                            }
                        }
                    }
                    .frame(maxHeight: 300)
                }
            }
            .padding(12)
            .frame(maxWidth: 360)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(.ultraThinMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color(.separator).opacity(0.35), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
            .padding(.top, 58)
            .padding(.horizontal, 12)
            .onTapGesture {
                // Keep taps inside the dropdown from dismissing the backdrop.
            }
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
    }

    @ViewBuilder
    private func sessionRow(_ session: SessionInfo) -> some View {
        let isCurrent = session.key == currentSessionKey

        Button {
            onSelect(session.key)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(session.name)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    HStack(spacing: 5) {
                        Text(session.kindLabel)
                            .font(.caption2.monospaced())
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(
                                RoundedRectangle(cornerRadius: 5)
                                    .fill(Color(.tertiarySystemFill))
                            )
                        if let model = session.model, !model.isEmpty {
                            Text("•")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(model)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }

                Spacer(minLength: 0)

                VStack(alignment: .trailing, spacing: 5) {
                    if !session.relativeUpdatedAt.isEmpty {
                        Text(session.relativeUpdatedAt)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if isCurrent {
                        if sessionSwitching {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "checkmark")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.green)
                        }
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(isCurrent ? Color.accentColor.opacity(0.14) : Color.clear)
            )
        }
        .buttonStyle(.plain)
    }
}
