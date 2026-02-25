import SwiftUI

struct NativeSetupDialog: View {
    let onConnect: (ConnectionConfig) -> Void

    @State private var url: String = ""
    @State private var token: String = ""
    @State private var isConnecting = false
    @State private var error: String?

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Gateway") {
                    TextField("URL (e.g. https://your-gateway.example)", text: $url)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)

                    SecureField("Token (optional)", text: $token)
                        .textContentType(.password)
                }

                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }

                Section {
                    Button {
                        connect()
                    } label: {
                        HStack {
                            Spacer()
                            if isConnecting {
                                ProgressView()
                                    .padding(.trailing, 8)
                            }
                            Text("Connect")
                                .fontWeight(.semibold)
                            Spacer()
                        }
                    }
                    .disabled(url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isConnecting)
                }
            }
            .navigationTitle("Connect")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear {
                // Restore saved values
                if let savedURL = UserDefaults.standard.string(forKey: "gateway-url") {
                    url = savedURL
                }
                if let savedToken = KeychainHelper.load(key: "gateway-token") {
                    token = savedToken
                }
            }
        }
    }

    private func connect() {
        let trimmedURL = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedURL.isEmpty else { return }

        isConnecting = true
        error = nil

        let config = ConnectionConfig(
            mode: .openclaw,
            url: trimmedURL,
            token: token.isEmpty ? nil : token,
            model: nil
        )
        onConnect(config)
    }
}
