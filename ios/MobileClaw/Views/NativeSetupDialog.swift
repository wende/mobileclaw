import SwiftUI

private let setupDialogBrandInk = Color(red: 49 / 255, green: 49 / 255, blue: 49 / 255)

enum DialogPhase {
    case idle, entering, open, closing, closed

    var scale: CGFloat {
        switch self {
        case .entering: return 0.9
        case .open: return 1.0
        case .closing: return 0.8
        case .idle, .closed: return 0.9
        }
    }

    var yOffset: CGFloat {
        switch self {
        case .entering: return 20
        case .open: return 0
        case .closing: return -40
        case .idle, .closed: return 20
        }
    }

    var cardOpacity: Double {
        switch self {
        case .open: return 1
        default: return 0
        }
    }

    var backdropOpacity: Double {
        switch self {
        case .open: return 1
        default: return 0
        }
    }
}

struct NativeSetupDialog: View {
    let onConnect: (ConnectionConfig) -> Void
    var onClose: (() -> Void)?
    var visible: Bool = false
    var connectionError: String?

    @State private var mode: BackendMode = .openclaw
    @State private var url: String = "ws://127.0.0.1:18789"
    @State private var token: String = ""
    @State private var lmsUrl: String = "http://127.0.0.1:1234"
    @State private var lmsApiKey: String = ""
    @State private var lmsModel: String = ""
    @State private var lmsModels: [String] = []
    @State private var lmsModelLoading = false
    @State private var lmsModelError: String?
    @State private var isSubmitting = false
    @State private var error: String?
    @State private var phase: DialogPhase = .idle
    @State private var logoScale: CGFloat = 1.0
    @State private var keyboardHeight: CGFloat = 0

    private var trimmedURL: String { url.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var modeTitle: String {
        switch mode {
        case .openclaw: return "Connect to OpenClaw"
        case .lmstudio: return "Connect to LM Studio"
        case .demo: return "Demo Mode"
        }
    }

    private var buttonLabel: String {
        switch mode {
        case .demo: return "Start Demo"
        case .lmstudio: return "Connect"
        case .openclaw: return "Connect"
        }
    }

    private var isVisible: Bool {
        phase != .idle && phase != .closed
    }

    var body: some View {
        ZStack {
            // Backdrop
            Color(.systemBackground)
                .opacity(0.8 * phase.backdropOpacity)
                .overlay(
                    Rectangle()
                        .fill(.ultraThinMaterial)
                        .opacity(phase.backdropOpacity)
                )
                .onTapGesture {
                    guard phase == .open else { return }
                    dismissKeyboard()
                    animateClose {
                        onClose?()
                    }
                }

            // Card — centered in visible area above keyboard
            ScrollView {
                cardContent
            }
            .scrollDismissesKeyboard(.interactively)
            .frame(maxWidth: 380)
            .frame(maxHeight: UIScreen.main.bounds.height * 0.85)
            .fixedSize(horizontal: false, vertical: true)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color(.systemBackground))
                    .strokeBorder(Color(.separator).opacity(0.3), lineWidth: 0.5)
                    .shadow(color: setupDialogBrandInk.opacity(0.12), radius: 16, y: 8)
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal, 16)
            .offset(y: -(keyboardHeight / 2) + phase.yOffset)
            .scaleEffect(phase.scale)
            .opacity(phase.cardOpacity)
            .allowsHitTesting(phase == .open)
        }
        .opacity(isVisible ? 1 : 0)
        .allowsHitTesting(isVisible)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
            guard let endFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
                  let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double else { return }
            let screenHeight = UIScreen.main.bounds.height
            let newHeight = max(0, screenHeight - endFrame.origin.y)
            withAnimation(.easeOut(duration: duration)) {
                keyboardHeight = newHeight
            }
        }
        .onChange(of: visible) { _, newValue in
            handleVisibilityChange(newValue)
        }
        .onChange(of: connectionError) { _, _ in
            isSubmitting = false
        }
    }

    // MARK: - Card Content

    @ViewBuilder
    private var cardContent: some View {
        VStack(spacing: 0) {
            // Logo — tap for demo mode (secret shortcut)
            Button {
                animateClose {
                    onConnect(ConnectionConfig(mode: .demo, url: "", token: nil, model: nil))
                }
            } label: {
                setupLogoView
                    .scaleEffect(logoScale)
                    .shadow(color: phase == .closing ? Color.primary.opacity(0.15) : .clear, radius: 10)
            }
            .padding(.top, 24)
            .padding(.bottom, 12)

            // Title
            Text(modeTitle)
                .font(.title3.weight(.semibold))
                .padding(.bottom, 4)

            Text(mode == .demo ? "Try MobileClaw without a server." : "Choose a backend and configure your connection.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.bottom, 20)

            // Mode segmented control
            HStack(spacing: 2) {
                modeButton("OpenClaw", selected: mode == .openclaw) {
                    mode = .openclaw
                    error = nil
                }
                modeButton("LM Studio", selected: mode == .lmstudio) {
                    mode = .lmstudio
                    error = nil
                }
                modeButton("Demo", selected: mode == .demo) {
                    mode = .demo
                    error = nil
                }
            }
            .padding(2)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(.secondarySystemBackground))
            )
            .padding(.horizontal, 24)
            .padding(.bottom, 20)

            // Form fields
            if mode == .openclaw {
                VStack(spacing: 16) {
                    openClawFields
                }
                .padding(.horizontal, 24)
            } else if mode == .lmstudio {
                VStack(spacing: 16) {
                    lmStudioFields
                }
                .padding(.horizontal, 24)
            }

            // Error (form validation)
            if let error, !error.isEmpty {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 24)
                    .padding(.top, 8)
            }

            // Connection error from parent
            if let connectionError, !connectionError.isEmpty {
                Text(connectionError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 24)
                    .padding(.top, 8)
            }

            // Connect button
            Button {
                handleSubmit()
            } label: {
                HStack(spacing: 8) {
                    if isSubmitting {
                        ProgressView()
                            .tint(.white)
                            .controlSize(.small)
                    }
                    Text(buttonLabel)
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(.label))
                )
                .foregroundStyle(Color(.systemBackground))
            }
            .disabled(isSubmitting || (mode == .lmstudio && lmsModel.isEmpty))
            .opacity(isSubmitting || (mode == .lmstudio && lmsModel.isEmpty) ? 0.5 : 1)
            .padding(.horizontal, 24)
            .padding(.top, 20)
        }
        .padding(.bottom, 24)
    }

    // MARK: - OpenClaw fields

    @ViewBuilder
    private var openClawFields: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Server URL")
                .font(.caption)
                .foregroundStyle(.secondary)

            TextField("ws://127.0.0.1:18789", text: $url)
                .keyboardType(.URL)
                .textContentType(.URL)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(.systemBackground))
                        .strokeBorder(
                            (error != nil || connectionError != nil)
                                ? Color.red.opacity(0.5)
                                : Color(.separator).opacity(0.3),
                            lineWidth: 0.5
                        )
                )
                .font(.system(.subheadline, design: .monospaced))
        }

        if !trimmedURL.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Gateway Token")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("(optional)")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }

                SecureField("Enter gateway auth token", text: $token)
                    .textContentType(.password)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(.systemBackground))
                            .strokeBorder(Color(.separator).opacity(0.3), lineWidth: 0.5)
                    )
                    .font(.system(.subheadline, design: .monospaced))
            }
        }
    }

    // MARK: - LM Studio fields

    @ViewBuilder
    private var lmStudioFields: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("LM Studio URL")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                TextField("http://127.0.0.1:1234", text: $lmsUrl)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(.systemBackground))
                            .strokeBorder(lmsModelError != nil ? Color.red.opacity(0.5) : Color(.separator).opacity(0.3), lineWidth: 0.5)
                    )
                    .font(.system(.subheadline, design: .monospaced))

                Button {
                    fetchModels()
                } label: {
                    HStack(spacing: 4) {
                        if lmsModelLoading {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 12))
                        }
                        Text("Fetch")
                            .font(.caption.weight(.medium))
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(.secondarySystemBackground))
                            .strokeBorder(Color(.separator).opacity(0.3), lineWidth: 0.5)
                    )
                }
                .disabled(lmsModelLoading || lmsUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            if let lmsModelError {
                Text(lmsModelError)
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        }

        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("API Key")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("(optional)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            SecureField("lm-studio or leave empty", text: $lmsApiKey)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(.systemBackground))
                        .strokeBorder(Color(.separator).opacity(0.3), lineWidth: 0.5)
                )
                .font(.system(.subheadline, design: .monospaced))
        }

        VStack(alignment: .leading, spacing: 6) {
            Text("Model")
                .font(.caption)
                .foregroundStyle(.secondary)

            if lmsModels.isEmpty {
                TextField("Click Fetch or type model name", text: $lmsModel)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(.systemBackground))
                            .strokeBorder(Color(.separator).opacity(0.3), lineWidth: 0.5)
                    )
                    .font(.system(.subheadline, design: .monospaced))
            } else {
                Picker("Model", selection: $lmsModel) {
                    ForEach(lmsModels, id: \.self) { model in
                        Text(model).tag(model)
                    }
                }
                .pickerStyle(.menu)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(.systemBackground))
                        .strokeBorder(Color(.separator).opacity(0.3), lineWidth: 0.5)
                )
            }
        }
    }

    // MARK: - Logo

    @ViewBuilder
    private var setupLogoView: some View {
        if #available(iOS 26.0, *) {
            Image("Logo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 46, height: 46)
                .frame(width: 48, height: 48)
                .glassEffect(.regular, in: .circle)
        } else {
            Image("Logo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 46, height: 46)
                .frame(width: 48, height: 48)
                .background(
                    Circle()
                        .fill(Color(.secondarySystemBackground))
                        .strokeBorder(Color(.separator).opacity(0.3), lineWidth: 0.5)
                )
                .clipShape(Circle())
        }
    }

    // MARK: - Helpers

    private func modeButton(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.subheadline.weight(.medium))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(selected ? Color(.systemBackground) : .clear)
                        .shadow(color: selected ? setupDialogBrandInk.opacity(0.06) : .clear, radius: 2, y: 1)
                )
                .foregroundStyle(selected ? .primary : .secondary)
        }
    }

    private func handleVisibilityChange(_ newVisible: Bool) {
        if newVisible && (phase == .idle || phase == .closed) {
            dismissKeyboard()
            isSubmitting = false
            restoreSavedValues()
            error = nil
            // Set entering state without animation (invisible starting position)
            phase = .entering
            // Next frame: animate to open
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                withAnimation(.easeOut(duration: 0.3)) {
                    phase = .open
                }
            }
        } else if !newVisible && phase == .open {
            animateClose(completion: nil)
        }
    }

    private func animateClose(completion: (() -> Void)?) {
        dismissKeyboard()
        withAnimation(.easeOut(duration: 0.2)) {
            logoScale = 1.2
        }
        withAnimation(.easeOut(duration: 0.3)) {
            phase = .closing
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            phase = .closed
            logoScale = 1.0
            completion?()
        }
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private func restoreSavedValues() {
        if let savedMode = UserDefaults.standard.string(forKey: "backend-mode"),
           let m = BackendMode(rawValue: savedMode) {
            mode = m
        }
        if let savedURL = UserDefaults.standard.string(forKey: "gateway-url"), !savedURL.isEmpty {
            url = savedURL
        } else {
            url = "ws://127.0.0.1:18789"
        }
        if let savedToken = KeychainHelper.load(key: "gateway-token") {
            token = savedToken
        }
        if let savedLmsUrl = UserDefaults.standard.string(forKey: "lmstudio-url") {
            lmsUrl = savedLmsUrl
        }
        if let savedLmsKey = KeychainHelper.load(key: "lmstudio-apikey") {
            lmsApiKey = savedLmsKey
        }
        if let savedLmsModel = UserDefaults.standard.string(forKey: "lmstudio-model") {
            lmsModel = savedLmsModel
        }
    }

    private func handleSubmit() {
        if mode == .demo {
            isSubmitting = true
            animateClose {
                onConnect(ConnectionConfig(mode: .demo, url: "", token: nil, model: nil))
            }
            return
        }

        if mode == .openclaw {
            guard !trimmedURL.isEmpty else {
                error = "Please enter a server URL"
                return
            }
            guard URL(string: trimmedURL) != nil else {
                error = "Please enter a valid URL"
                return
            }
            error = nil
            isSubmitting = true

            // Save
            UserDefaults.standard.set("openclaw", forKey: "backend-mode")
            UserDefaults.standard.set(trimmedURL, forKey: "gateway-url")
            if !token.isEmpty {
                KeychainHelper.save(key: "gateway-token", value: token)
            }

            animateClose {
                onConnect(ConnectionConfig(mode: .openclaw, url: trimmedURL, token: token.isEmpty ? nil : token, model: nil))
            }
        } else {
            let trimmedLms = lmsUrl.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedLms.isEmpty else {
                error = "Please enter the LM Studio server URL"
                return
            }
            guard URL(string: trimmedLms) != nil else {
                error = "Please enter a valid URL"
                return
            }
            guard !lmsModel.isEmpty else {
                error = "Please select a model"
                return
            }
            error = nil
            isSubmitting = true

            // Save
            UserDefaults.standard.set("lmstudio", forKey: "backend-mode")
            UserDefaults.standard.set(trimmedLms, forKey: "lmstudio-url")
            UserDefaults.standard.set(lmsModel, forKey: "lmstudio-model")
            if !lmsApiKey.isEmpty {
                KeychainHelper.save(key: "lmstudio-apikey", value: lmsApiKey)
            }

            animateClose {
                onConnect(ConnectionConfig(mode: .lmstudio, url: trimmedLms, token: lmsApiKey.isEmpty ? nil : lmsApiKey, model: lmsModel))
            }
        }
    }

    private func fetchModels() {
        let trimmed = lmsUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        lmsModelLoading = true
        lmsModelError = nil

        Task {
            do {
                let baseURL = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
                let url = URL(string: "\(baseURL)/v1/models")!
                var request = URLRequest(url: url)
                if !lmsApiKey.isEmpty {
                    request.setValue("Bearer \(lmsApiKey)", forHTTPHeaderField: "Authorization")
                }
                let (data, _) = try await URLSession.shared.data(for: request)
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let dataArray = json["data"] as? [[String: Any]] {
                    let models = dataArray.compactMap { $0["id"] as? String }
                    lmsModels = models
                    if !models.isEmpty && lmsModel.isEmpty {
                        lmsModel = models[0]
                    }
                }
            } catch {
                lmsModelError = "Cannot reach server: \(error.localizedDescription)"
                lmsModels = []
            }
            lmsModelLoading = false
        }
    }
}
