import SwiftUI

struct NativeSetupDialog: View {
    let onConnect: (ConnectionConfig) -> Void

    @State private var mode: BackendMode = .openclaw
    @State private var url: String = ""
    @State private var token: String = ""
    @State private var lmsUrl: String = "http://127.0.0.1:1234"
    @State private var lmsApiKey: String = ""
    @State private var lmsModel: String = ""
    @State private var lmsModels: [String] = []
    @State private var lmsModelLoading = false
    @State private var lmsModelError: String?
    @State private var isSubmitting = false
    @State private var error: String?

    @Environment(\.dismiss) private var dismiss

    private var trimmedURL: String { url.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isOpenClawEmpty: Bool { mode == .openclaw && trimmedURL.isEmpty }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    // Logo — tap for demo mode (secret shortcut)
                    Button {
                        enterDemo()
                    } label: {
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
                    .padding(.top, 20)
                    .padding(.bottom, 12)

                    // Title
                    Text("Connect to \(mode == .lmstudio ? "LM Studio" : "OpenClaw")")
                        .font(.title3.weight(.semibold))
                        .padding(.bottom, 4)

                    Text("Choose a backend and configure your connection.")
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
                    }
                    .padding(2)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(.secondarySystemBackground))
                    )
                    .padding(.horizontal, 24)
                    .padding(.bottom, 20)

                    // Form fields
                    VStack(spacing: 16) {
                        if mode == .openclaw {
                            openClawFields
                        } else {
                            lmStudioFields
                        }
                    }
                    .padding(.horizontal, 24)

                    // Error
                    if let error, !error.isEmpty {
                        Text(error)
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
                            Text(isOpenClawEmpty ? "Start Demo" : "Connect")
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

                    if mode == .openclaw {
                        Text("Leave empty to use demo mode without a server")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .padding(.top, 8)
                    }
                }
                .padding(.bottom, 24)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear { restoreSavedValues() }
        }
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
                        .strokeBorder(error != nil ? Color.red.opacity(0.5) : Color(.separator).opacity(0.3), lineWidth: 0.5)
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
                        .shadow(color: selected ? .black.opacity(0.06) : .clear, radius: 2, y: 1)
                )
                .foregroundStyle(selected ? .primary : .secondary)
        }
    }

    private func restoreSavedValues() {
        if let savedMode = UserDefaults.standard.string(forKey: "backend-mode"),
           let m = BackendMode(rawValue: savedMode) {
            mode = m
        }
        if let savedURL = UserDefaults.standard.string(forKey: "gateway-url") {
            url = savedURL
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

    private func enterDemo() {
        isSubmitting = true
        onConnect(ConnectionConfig(mode: .demo, url: "", token: nil, model: nil))
    }

    private func handleSubmit() {
        if mode == .openclaw {
            if trimmedURL.isEmpty {
                enterDemo()
                return
            }
            guard URL(string: trimmedURL) != nil else {
                error = "Please enter a valid URL or leave empty for demo mode"
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

            onConnect(ConnectionConfig(mode: .openclaw, url: trimmedURL, token: token.isEmpty ? nil : token, model: nil))
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

            onConnect(ConnectionConfig(mode: .lmstudio, url: trimmedLms, token: lmsApiKey.isEmpty ? nil : lmsApiKey, model: lmsModel))
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
