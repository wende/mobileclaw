import SwiftUI
import UIKit

enum FadeDirection {
    case topToBottom  // opaque at top, transparent at bottom
    case bottomToTop  // transparent at top, opaque at bottom
}

struct FadingBlurView: UIViewRepresentable {
    let direction: FadeDirection

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .clear
        container.clipsToBounds = true

        let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
        blur.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(blur)
        NSLayoutConstraint.activate([
            blur.topAnchor.constraint(equalTo: container.topAnchor),
            blur.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            blur.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            blur.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])

        let mask = GradientMaskLayer()
        mask.direction = direction
        blur.layer.mask = mask
        context.coordinator.maskLayer = mask

        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.maskLayer?.direction = direction
        context.coordinator.maskLayer?.setNeedsLayout()
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    class Coordinator {
        var maskLayer: GradientMaskLayer?
    }
}

class GradientMaskLayer: CAGradientLayer {
    var direction: FadeDirection = .topToBottom {
        didSet { updateColors() }
    }

    override init() {
        super.init()
        updateColors()
    }

    override init(layer: Any) {
        super.init(layer: layer)
        if let other = layer as? GradientMaskLayer {
            direction = other.direction
        }
        updateColors()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        updateColors()
    }

    override func layoutSublayers() {
        super.layoutSublayers()
        frame = superlayer?.bounds ?? .zero
    }

    private func updateColors() {
        switch direction {
        case .topToBottom:
            colors = [UIColor.white.cgColor, UIColor.white.cgColor, UIColor.clear.cgColor]
            locations = [0, 0.3, 1]
        case .bottomToTop:
            colors = [UIColor.clear.cgColor, UIColor.white.cgColor, UIColor.white.cgColor]
            locations = [0, 0.7, 1]
        }
    }
}
