//
//  SettingsView.swift
//  JarvisRemote
//
//  Server configuration and app settings
//

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var jarvisService: JarvisService
    @Environment(\.dismiss) var dismiss
    
    @State private var serverHost: String = ""
    @State private var serverPort: String = ""
    @State private var useTLS: Bool = false
    @State private var showConnectionTest = false
    @State private var testResult: TestResult?
    
    enum TestResult {
        case success
        case failure(String)
    }
    
    var body: some View {
        NavigationView {
            ZStack {
                JarvisColors.background.ignoresSafeArea()
                
                ScrollView {
                    VStack(spacing: 30) {
                        // Server Configuration Section
                        serverConfigSection
                        
                        // Connection Section
                        connectionSection
                        
                        // About Section
                        aboutSection
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .foregroundColor(JarvisColors.textSecondary)
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        saveSettings()
                        dismiss()
                    }
                    .foregroundColor(JarvisColors.cyan)
                    .fontWeight(.medium)
                }
            }
            .onAppear {
                loadCurrentSettings()
            }
        }
    }
    
    // MARK: - Server Config Section
    private var serverConfigSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHeader(title: "SERVER CONFIGURATION")
            
            VStack(spacing: 12) {
                // Host input
                HUDTextField(
                    title: "HOST",
                    placeholder: "192.168.1.100 or jarvis.local",
                    text: $serverHost
                )
                
                // Port input
                HUDTextField(
                    title: "PORT",
                    placeholder: "3456",
                    text: $serverPort,
                    keyboardType: .numberPad
                )
                
                // TLS toggle
                HUDToggle(
                    title: "USE TLS (HTTPS/WSS)",
                    isOn: $useTLS
                )
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(JarvisColors.backgroundSecondary)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(JarvisColors.cyan.opacity(0.2), lineWidth: 1)
                    )
            )
        }
    }
    
    // MARK: - Connection Section
    private var connectionSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHeader(title: "CONNECTION")
            
            VStack(spacing: 12) {
                // Current status
                HStack {
                    Text("STATUS")
                        .font(JarvisTypography.monoSmall)
                        .foregroundColor(JarvisColors.textTertiary)
                    
                    Spacer()
                    
                    ConnectionStatusView(state: jarvisService.connectionState)
                }
                
                Divider()
                    .background(JarvisColors.cyan.opacity(0.2))
                
                // Connect/Disconnect button
                HUDButton(
                    title: jarvisService.connectionState.isConnected ? "DISCONNECT" : "CONNECT",
                    style: jarvisService.connectionState.isConnected ? .secondary : .primary
                ) {
                    if jarvisService.connectionState.isConnected {
                        jarvisService.disconnect()
                    } else {
                        saveSettings()
                        jarvisService.connect()
                    }
                }
                
                // Test connection button
                HUDButton(
                    title: "TEST CONNECTION",
                    style: .secondary
                ) {
                    testConnection()
                }
                
                // Test result
                if let result = testResult {
                    HStack {
                        Image(systemName: result.isSuccess ? "checkmark.circle" : "xmark.circle")
                            .foregroundColor(result.isSuccess ? JarvisColors.success : JarvisColors.error)
                        
                        Text(result.message)
                            .font(JarvisTypography.caption)
                            .foregroundColor(result.isSuccess ? JarvisColors.success : JarvisColors.error)
                        
                        Spacer()
                    }
                    .padding(.top, 8)
                }
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(JarvisColors.backgroundSecondary)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(JarvisColors.cyan.opacity(0.2), lineWidth: 1)
                    )
            )
        }
    }
    
    // MARK: - About Section
    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHeader(title: "ABOUT")
            
            VStack(spacing: 12) {
                HStack {
                    Text("VERSION")
                        .font(JarvisTypography.monoSmall)
                        .foregroundColor(JarvisColors.textTertiary)
                    
                    Spacer()
                    
                    Text("1.0.0")
                        .font(JarvisTypography.mono)
                        .foregroundColor(JarvisColors.textSecondary)
                }
                
                Divider()
                    .background(JarvisColors.cyan.opacity(0.2))
                
                HStack {
                    Text("AUDIO PERMISSION")
                        .font(JarvisTypography.monoSmall)
                        .foregroundColor(JarvisColors.textTertiary)
                    
                    Spacer()
                    
                    Text(jarvisService.hasAudioPermission ? "GRANTED" : "DENIED")
                        .font(JarvisTypography.mono)
                        .foregroundColor(jarvisService.hasAudioPermission ? JarvisColors.success : JarvisColors.error)
                }
                
                if !jarvisService.hasAudioPermission {
                    HUDButton(title: "REQUEST PERMISSION", style: .secondary) {
                        jarvisService.requestAudioPermission()
                    }
                }
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(JarvisColors.backgroundSecondary)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(JarvisColors.cyan.opacity(0.2), lineWidth: 1)
                    )
            )
        }
    }
    
    // MARK: - Helper Methods
    private func loadCurrentSettings() {
        serverHost = jarvisService.serverConfig.host
        serverPort = String(jarvisService.serverConfig.port)
        useTLS = jarvisService.serverConfig.useTLS
    }
    
    private func saveSettings() {
        jarvisService.serverConfig = ServerConfig(
            host: serverHost,
            port: Int(serverPort) ?? 3456,
            useTLS: useTLS
        )
        jarvisService.saveConfig()
    }
    
    private func testConnection() {
        testResult = nil
        
        let config = ServerConfig(
            host: serverHost,
            port: Int(serverPort) ?? 3456,
            useTLS: useTLS
        )
        
        guard let url = config.httpBaseURL?.appendingPathComponent("health") else {
            testResult = .failure("Invalid URL configuration")
            return
        }
        
        var request = URLRequest(url: url)
        request.timeoutInterval = 5
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    testResult = .failure(error.localizedDescription)
                } else if let httpResponse = response as? HTTPURLResponse,
                          httpResponse.statusCode == 200 {
                    testResult = .success
                } else {
                    testResult = .failure("Server returned unexpected response")
                }
            }
        }.resume()
    }
}

// MARK: - TestResult Extension
extension SettingsView.TestResult {
    var isSuccess: Bool {
        if case .success = self { return true }
        return false
    }
    
    var message: String {
        switch self {
        case .success:
            return "Connection successful"
        case .failure(let error):
            return error
        }
    }
}

// MARK: - Section Header
struct SectionHeader: View {
    let title: String
    
    var body: some View {
        HStack(spacing: 8) {
            Rectangle()
                .fill(JarvisColors.cyan)
                .frame(width: 3, height: 14)
            
            Text(title)
                .font(JarvisTypography.monoSmall)
                .foregroundColor(JarvisColors.cyan)
                .tracking(2)
        }
    }
}

// MARK: - HUD TextField
struct HUDTextField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(JarvisTypography.monoSmall)
                .foregroundColor(JarvisColors.textTertiary)
                .tracking(1)
            
            TextField(placeholder, text: $text)
                .font(JarvisTypography.body)
                .foregroundColor(JarvisColors.textPrimary)
                .keyboardType(keyboardType)
                .autocapitalization(.none)
                .disableAutocorrection(true)
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(JarvisColors.backgroundTertiary)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(JarvisColors.cyan.opacity(0.3), lineWidth: 1)
                        )
                )
        }
    }
}

// MARK: - HUD Toggle
struct HUDToggle: View {
    let title: String
    @Binding var isOn: Bool
    
    var body: some View {
        HStack {
            Text(title)
                .font(JarvisTypography.monoSmall)
                .foregroundColor(JarvisColors.textTertiary)
                .tracking(1)
            
            Spacer()
            
            Toggle("", isOn: $isOn)
                .toggleStyle(HUDToggleStyle())
        }
    }
}

struct HUDToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack {
            configuration.label
            
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .fill(configuration.isOn ? JarvisColors.cyan.opacity(0.3) : JarvisColors.backgroundTertiary)
                    .frame(width: 50, height: 30)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(configuration.isOn ? JarvisColors.cyan : JarvisColors.cyan.opacity(0.3), lineWidth: 1)
                    )
                
                Circle()
                    .fill(configuration.isOn ? JarvisColors.cyan : JarvisColors.textTertiary)
                    .frame(width: 22, height: 22)
                    .offset(x: configuration.isOn ? 10 : -10)
                    .animation(.jarvisSpring, value: configuration.isOn)
            }
            .onTapGesture {
                configuration.isOn.toggle()
            }
        }
    }
}

// MARK: - HUD Button
struct HUDButton: View {
    enum Style {
        case primary
        case secondary
    }
    
    let title: String
    let style: Style
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(JarvisTypography.mono)
                .foregroundColor(style == .primary ? JarvisColors.background : JarvisColors.cyan)
                .tracking(1)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(style == .primary ? JarvisColors.cyan : Color.clear)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(JarvisColors.cyan, lineWidth: 1)
                        )
                )
        }
    }
}

// MARK: - Preview
struct SettingsView_Previews: PreviewProvider {
    static var previews: some View {
        SettingsView()
            .environmentObject(JarvisService())
    }
}
