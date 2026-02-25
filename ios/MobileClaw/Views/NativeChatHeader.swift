import SwiftUI

struct NativeChatHeader: View {
    let currentModel: String?
    let connectionState: ConnectionState
    let onOpenSetup: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // Logo / setup button
            Button(action: onOpenSetup) {
                Image("Logo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 34, height: 34)
                    .frame(width: 36, height: 36)
                    .background(
                        Circle()
                            .fill(.white)
                            .frame(width: 36, height: 36)
                            .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
                    )
                    .clipShape(Circle())
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
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
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
