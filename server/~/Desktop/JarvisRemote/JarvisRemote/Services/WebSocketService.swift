//
//  WebSocketService.swift
//  JarvisRemote
//
//  WebSocket connection manager with reconnection logic
//

import Foundation
import Combine

protocol WebSocketServiceDelegate: AnyObject {
    func webSocketDidConnect()
    func webSocketDidDisconnect(error: Error?)
    func webSocketDidReceiveMessage(_ message: JarvisMessage)
    func webSocketDidReceiveAudioData(_ data: Data)
}

final class WebSocketService: NSObject {
    // MARK: - Properties
    weak var delegate: WebSocketServiceDelegate?
    
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession!
    private var serverConfig: ServerConfig
    
    private var isConnected = false
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 5
    private let reconnectDelay: TimeInterval = 2.0
    
    private var pingTimer: Timer?
    private let pingInterval: TimeInterval = 30.0
    
    // MARK: - Initialization
    init(config: ServerConfig = .default) {
        self.serverConfig = config
        super.init()
        
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 300
        self.session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }
    
    // MARK: - Connection Management
    func connect() {
        guard let url = serverConfig.webSocketURL else {
            print("[WebSocket] Invalid URL configuration")
            return
        }
        
        disconnect()
        
        print("[WebSocket] Connecting to \(url.absoluteString)")
        
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        
        webSocketTask = session.webSocketTask(with: request)
        webSocketTask?.resume()
        
        receiveMessage()
        startPingTimer()
    }
    
    func disconnect() {
        stopPingTimer()
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        isConnected = false
    }
    
    func updateConfig(_ config: ServerConfig) {
        self.serverConfig = config
    }
    
    // MARK: - Sending Messages
    func send(message: JarvisMessage) {
        guard isConnected else {
            print("[WebSocket] Cannot send - not connected")
            return
        }
        
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(message)
            
            webSocketTask?.send(.data(data)) { error in
                if let error = error {
                    print("[WebSocket] Send error: \(error.localizedDescription)")
                }
            }
        } catch {
            print("[WebSocket] Encoding error: \(error.localizedDescription)")
        }
    }
    
    func sendAudioData(_ data: Data) {
        guard isConnected else { return }
        
        // Send raw audio data as binary
        webSocketTask?.send(.data(data)) { error in
            if let error = error {
                print("[WebSocket] Audio send error: \(error.localizedDescription)")
            }
        }
    }
    
    func sendAudioStart() {
        let message = JarvisMessage(type: .audioStart)
        send(message: message)
    }
    
    func sendAudioEnd() {
        let message = JarvisMessage(type: .audioEnd)
        send(message: message)
    }
    
    // MARK: - Receiving Messages
    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }
            
            switch result {
            case .success(let message):
                self.handleMessage(message)
                self.receiveMessage() // Continue listening
                
            case .failure(let error):
                print("[WebSocket] Receive error: \(error.localizedDescription)")
                self.handleDisconnection(error: error)
            }
        }
    }
    
    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .data(let data):
            // Check if it's audio data (raw) or JSON
            if let jsonMessage = try? JSONDecoder().decode(JarvisMessage.self, from: data) {
                delegate?.webSocketDidReceiveMessage(jsonMessage)
            } else {
                // Treat as raw audio data
                delegate?.webSocketDidReceiveAudioData(data)
            }
            
        case .string(let text):
            if let data = text.data(using: .utf8),
               let jsonMessage = try? JSONDecoder().decode(JarvisMessage.self, from: data) {
                delegate?.webSocketDidReceiveMessage(jsonMessage)
            }
            
        @unknown default:
            break
        }
    }
    
    // MARK: - Reconnection Logic
    private func handleDisconnection(error: Error?) {
        isConnected = false
        stopPingTimer()
        delegate?.webSocketDidDisconnect(error: error)
        
        attemptReconnection()
    }
    
    private func attemptReconnection() {
        guard reconnectAttempts < maxReconnectAttempts else {
            print("[WebSocket] Max reconnection attempts reached")
            reconnectAttempts = 0
            return
        }
        
        reconnectAttempts += 1
        let delay = reconnectDelay * Double(reconnectAttempts)
        
        print("[WebSocket] Reconnecting in \(delay)s (attempt \(reconnectAttempts))")
        
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.connect()
        }
    }
    
    // MARK: - Ping/Pong
    private func startPingTimer() {
        pingTimer = Timer.scheduledTimer(withTimeInterval: pingInterval, repeats: true) { [weak self] _ in
            self?.sendPing()
        }
    }
    
    private func stopPingTimer() {
        pingTimer?.invalidate()
        pingTimer = nil
    }
    
    private func sendPing() {
        webSocketTask?.sendPing { [weak self] error in
            if let error = error {
                print("[WebSocket] Ping failed: \(error.localizedDescription)")
                self?.handleDisconnection(error: error)
            }
        }
    }
}

// MARK: - URLSessionWebSocketDelegate
extension WebSocketService: URLSessionWebSocketDelegate {
    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        print("[WebSocket] Connected")
        isConnected = true
        reconnectAttempts = 0
        delegate?.webSocketDidConnect()
    }
    
    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        print("[WebSocket] Closed with code: \(closeCode)")
        handleDisconnection(error: nil)
    }
}
