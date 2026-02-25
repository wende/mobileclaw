import SwiftUI

struct NativeImageLightbox: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @GestureState private var dragOffset: CGSize = .zero

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
                .opacity(Double(max(0, 1 - abs(combinedOffset.height) / 300)))

            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(scale)
                        .offset(combinedOffset)
                        .gesture(
                            MagnifyGesture()
                                .onChanged { value in
                                    scale = value.magnification
                                }
                                .onEnded { _ in
                                    withAnimation(.spring(response: 0.3)) {
                                        scale = max(1, min(scale, 4))
                                    }
                                }
                        )
                        .simultaneousGesture(
                            DragGesture()
                                .updating($dragOffset) { value, state, _ in
                                    if scale <= 1 {
                                        state = value.translation
                                    }
                                }
                                .onEnded { value in
                                    if abs(value.translation.height) > 100 {
                                        dismiss()
                                    } else {
                                        withAnimation(.spring(response: 0.3)) {
                                            offset = .zero
                                        }
                                    }
                                }
                        )

                case .failure:
                    VStack(spacing: 12) {
                        Image(systemName: "photo.badge.exclamationmark")
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                        Text("Failed to load image")
                            .foregroundStyle(.secondary)
                    }

                case .empty:
                    ProgressView()
                        .tint(.white)

                @unknown default:
                    EmptyView()
                }
            }
        }
        .onTapGesture(count: 2) {
            withAnimation(.spring(response: 0.3)) {
                scale = scale > 1 ? 1 : 2
            }
        }
        .onTapGesture {
            dismiss()
        }
        .statusBarHidden()
    }

    private var combinedOffset: CGSize {
        CGSize(
            width: offset.width + dragOffset.width,
            height: offset.height + dragOffset.height
        )
    }
}
