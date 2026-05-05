//
//  JarvisModels.swift
//  JarvisRemote
//
//  Data models for Jarvis communication
//

import Foundation

// MARK: - Connection State
enum ConnectionState: Equatable {
    case disconnected
    case connecting
    case connected
    case reconnecting(attempt: Int)
    case error(String)
    
    var displayText: String {
        switch self {
        case .disconnected:
            return "OFFLINE"
        case .connecting:
            return "CONNECTING"
        case .connected:
            return "CONNECTED"
        case .reconnecting(let attempt):
            return "RECONNECTING (\(attempt))"
        case .error(let message):
            return "ERROR: \(message)"
        }
    }
    
    var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }
}

// MARK: - Voice State
enum VoiceState: Equatable {
    case idle
    case listening
    case processing
    case speaking
    
    var displayText: String {
        switch self {
        case .idle:
            return "READY"
        case .listening:
            return "LISTENING"
        case .processing:
            return "PROCESSING"
        case .speaking:
            return "SPEAKING"
        }
    }
}

// MARK: - WebSocket Messages
struct JarvisMessage: Codable {
    let type: MessageType
    let payload: MessagePayload?
    let timestamp: Date
    
    enum MessageType: String, Codable {
        case audioData = "audio_data"
        case audioStart = "audio_start"
        case audioEnd = "audio_end"
        case textResponse = "text_response"
        case textPartial = "text_partial"
        case audioResponse = "audio_response"
        case status = "status"
        case error = "error"
        case ping = "ping"
        case pong = "pong"
    }
    
    struct MessagePayload: Codable {
        let text: String?
        let audioData: String? // Base64 encoded audio
        let sampleRate: Int?
        let status: String?
        let errorMessage: String?
    }
    
    init(type: MessageType, payload: MessagePayload? = nil) {
        self.type = type
        self.payload = payload
        self.timestamp = Date()
    }
}

// MARK: - Response Display
struct JarvisResponse: Identifiable, Equatable {
    let id: UUID
    let text: String
    let timestamp: Date
    let isPartial: Bool
    
    init(text: String, isPartial: Bool = false) {
        self.id = UUID()
        self.text = text
        self.timestamp = Date()
        self.isPartial = isPartial
    }
}

// MARK: - Audio Configuration
struct AudioConfig {
    static let sampleRate: Double = 16000
    static let channels: Int = 1
    static let bitsPerSample: Int = 16
    static let bufferSize: Int = 4096
}

// MARK: - Server Configuration
struct ServerConfig {
    var host: String
    var port: Int
    var useTLS: Bool
    
    var webSocketURL: URL? {
        let scheme = useTLS ? "wss" : "ws"
        return URL(string: "\(scheme)://\(host):\(port)/ws/voice")
    }
    
    var httpBaseURL: URL? {
        let scheme = useTLS ? "https" : "http"
        return URL(string: "\(scheme)://\(host):\(port)")
    }
    
    static let `default` = ServerConfig(
        host: "192.168.1.100", // Default - user should change
        port: 3456,
        useTLS: false
    )
}
