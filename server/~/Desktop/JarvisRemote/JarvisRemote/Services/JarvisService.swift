//
//  JarvisService.swift
//  JarvisRemote
//
//  Main service coordinating WebSocket, Audio, and UI state
//

import Foundation
import Combine
import SwiftUI

final class JarvisService: ObservableObject {
    // MARK: - Published State
    @Published var connectionState: ConnectionState = .disconnected
    @Published var voiceState: VoiceState = .idle
    @Published var currentResponse: String = ""
    @Published var responseHistory: [JarvisResponse] = []
    @Published var inputLevel: Float = 0
    @Published var outputLevels: [Float] = Array(repeating: 0, count: 30)
    @Published var serverConfig: ServerConfig = .default
    @Published var hasAudioPermission: Bool = false
    
    // MARK: - Services
    private let webSocketService: WebSocketService
    private let audioService: AudioService
    
    // MARK: - Private Properties
    private var cancellables = Set<AnyCancellable>()
    private var isTransmitting = false
    private var typewriterTimer: Timer?
    private var fullResponseText: String = ""
    private var displayedCharacterCount: Int = 0
    
    // MARK: - Initialization
    init() {
        self.webSocketService = WebSocketService()
        self.audioService = AudioService()
        
        setupDelegates()
        loadSavedConfig()
        checkAudioPermission()
    }
    
    private func setupDelegates() {
        webSocketService.delegate = self
        audioService.delegate = self
    }
    
    private func loadSavedConfig() {
        // Load from UserDefaults if saved
        if let host = UserDefaults.standard.string(forKey: "jarvis_server_host") {
            let port = UserDefaults.standard.integer(forKey: "jarvis_server_port")
            let useTLS = UserDefaults.standard.bool(forKey: "jarvis_server_tls")
            
            serverConfig = ServerConfig(
                host: host,
                port: port > 0 ? port : 3456,
                useTLS: useTLS
            )
        }
    }
    
    func saveConfig() {
        UserDefaults.standard.set(serverConfig.host, forKey: "jarvis_server_host")
        UserDefaults.standard.set(serverConfig.port, forKey: "jarvis_server_port")
        UserDefaults.standard.set(serverConfig.useTLS, forKey: "jarvis_server_tls")
    }
    
    // MARK: - Connection Management
    func connect() {
        guard connectionState != .connected else { return }
        
        connectionState = .connecting
        webSocketService.updateConfig(serverConfig)
        webSocketService.connect()
    }
    
    func disconnect() {
        webSocketService.disconnect()
        connectionState = .disconnected
        voiceState = .idle
    }
    
    func reconnect() {
        disconnect()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.connect()
        }
    }
    
    // MARK: - Voice Interaction
    func startListening() {
        guard connectionState.isConnected else {
            print("[Jarvis] Cannot listen - not connected")
            return
        }
        
        guard hasAudioPermission else {
            requestAudioPermission()
            return
        }
        
        guard voiceState == .idle else { return }
        
        isTransmitting = true
        voiceState = .listening
        currentResponse = ""
        
        // Notify server we're starting audio
        webSocketService.sendAudioStart()
        
        // Start capturing audio
        audioService.startRecording()
        
        // Haptic feedback
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()
    }
    
    func stopListening() {
        guard isTransmitting else { return }
        
        isTransmitting = false
        voiceState = .processing
        
        // Stop audio capture
        audioService.stopRecording()
        
        // Notify server audio ended
        webSocketService.sendAudioEnd()
        
        // Haptic feedback
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
    }
    
    // MARK: - Audio Permission
    func checkAudioPermission() {
        hasAudioPermission = audioService.hasPermission()
    }
    
    func requestAudioPermission() {
        audioService.requestPermission { [weak self] granted in
            self?.hasAudioPermission = granted
        }
    }
    
    // MARK: - Response Display
    private func displayResponse(_ text: String, isPartial: Bool = false) {
        if isPartial {
            currentResponse = text
        } else {
            startTypewriterEffect(text)
        }
    }
    
    private func startTypewriterEffect(_ text: String) {
        stopTypewriterEffect()
        
        fullResponseText = text
        displayedCharacterCount = 0
        currentResponse = ""
        
        let charactersPerSecond: Double = 50
        let interval = 1.0 / charactersPerSecond
        
        typewriterTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] timer in
            guard let self = self else {
                timer.invalidate()
                return
            }
            
            if self.displayedCharacterCount < self.fullResponseText.count {
                let index = self.fullResponseText.index(self.fullResponseText.startIndex, offsetBy: self.displayedCharacterCount)
                self.currentResponse = String(self.fullResponseText[...index])
                self.displayedCharacterCount += 1
            } else {
                self.stopTypewriterEffect()
                self.addToHistory(text)
            }
        }
    }
    
    private func stopTypewriterEffect() {
        typewriterTimer?.invalidate()
        typewriterTimer = nil
    }
    
    private func addToHistory(_ text: String) {
        let response = JarvisResponse(text: text)
        responseHistory.insert(response, at: 0)
        
        // Keep only last 10 responses
        if responseHistory.count > 10 {
            responseHistory.removeLast()
        }
    }
    
    // MARK: - Waveform Visualization
    private func updateOutputLevels(with data: Data) {
        // Generate visual levels from audio data
        let samples = data.withUnsafeBytes { buffer -> [Int16] in
            Array(buffer.bindMemory(to: Int16.self))
        }
        
        let chunkSize = max(1, samples.count / outputLevels.count)
        var newLevels: [Float] = []
        
        for i in 0..<outputLevels.count {
            let start = i * chunkSize
            let end = min(start + chunkSize, samples.count)
            
            if start < samples.count {
                let chunk = samples[start..<end]
                let rms = sqrt(chunk.map { Float($0) * Float($0) }.reduce(0, +) / Float(chunk.count))
                let normalized = min(1, rms / 32768.0 * 3) // Amplify for visualization
                newLevels.append(normalized)
            } else {
                newLevels.append(0)
            }
        }
        
        withAnimation(.easeOut(duration: 0.1)) {
            outputLevels = newLevels
        }
    }
    
    private func clearOutputLevels() {
        withAnimation(.easeOut(duration: 0.3)) {
            outputLevels = Array(repeating: 0, count: 30)
        }
    }
}

// MARK: - WebSocketServiceDelegate
extension JarvisService: WebSocketServiceDelegate {
    func webSocketDidConnect() {
        DispatchQueue.main.async {
            self.connectionState = .connected
            
            // Success haptic
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)
        }
    }
    
    func webSocketDidDisconnect(error: Error?) {
        DispatchQueue.main.async {
            if let error = error {
                self.connectionState = .error(error.localizedDescription)
            } else {
                self.connectionState = .disconnected
            }
            self.voiceState = .idle
        }
    }
    
    func webSocketDidReceiveMessage(_ message: JarvisMessage) {
        DispatchQueue.main.async {
            switch message.type {
            case .textResponse:
                if let text = message.payload?.text {
                    self.displayResponse(text)
                }
                
            case .textPartial:
                if let text = message.payload?.text {
                    self.displayResponse(text, isPartial: true)
                }
                
            case .status:
                if let status = message.payload?.status {
                    print("[Jarvis] Status: \(status)")
                }
                
            case .error:
                if let errorMessage = message.payload?.errorMessage {
                    print("[Jarvis] Error: \(errorMessage)")
                    self.connectionState = .error(errorMessage)
                }
                
            default:
                break
            }
        }
    }
    
    func webSocketDidReceiveAudioData(_ data: Data) {
        DispatchQueue.main.async {
            self.voiceState = .speaking
            self.updateOutputLevels(with: data)
        }
        audioService.playAudioData(data)
    }
}

// MARK: - AudioServiceDelegate
extension JarvisService: AudioServiceDelegate {
    func audioService(_ service: AudioService, didCaptureAudioData data: Data) {
        guard isTransmitting else { return }
        webSocketService.sendAudioData(data)
    }
    
    func audioService(_ service: AudioService, didUpdateInputLevel level: Float) {
        DispatchQueue.main.async {
            self.inputLevel = level
        }
    }
    
    func audioServiceDidStartPlaying(_ service: AudioService) {
        DispatchQueue.main.async {
            self.voiceState = .speaking
        }
    }
    
    func audioServiceDidFinishPlaying(_ service: AudioService) {
        DispatchQueue.main.async {
            self.voiceState = .idle
            self.clearOutputLevels()
        }
    }
}
