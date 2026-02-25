import SwiftUI

struct NativeChatHeader: View {
    let currentModel: String?
    let connectionState: ConnectionState
    let onOpenSetup: () -> Void

    var body: some View {
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
