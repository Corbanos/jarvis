//
//  AudioService.swift
//  JarvisRemote
//
//  Audio capture and playback using AVFoundation
//

import Foundation
import AVFoundation
import Combine

protocol AudioServiceDelegate: AnyObject {
    func audioService(_ service: AudioService, didCaptureAudioData data: Data)
    func audioService(_ service: AudioService, didUpdateInputLevel level: Float)
    func audioServiceDidStartPlaying(_ service: AudioService)
    func audioServiceDidFinishPlaying(_ service: AudioService)
}

final class AudioService: NSObject {
    // MARK: - Properties
    weak var delegate: AudioServiceDelegate?
    
    private var audioEngine: AVAudioEngine?
    private var inputNode: AVAudioInputNode?
    private var audioPlayer: AVAudioPlayerNode?
    private var audioFormat: AVAudioFormat?
    
    private var isRecording = false
    private var isPlaying = false
    
    private var audioBuffer: [Data] = []
    private let audioQueue = DispatchQueue(label: "com.jarvis.audio", qos: .userInteractive)
    
    // Audio level for visualization
    @Published var currentInputLevel: Float = 0
    @Published var currentOutputLevel: Float = 0
    
    // MARK: - Initialization
    override init() {
        super.init()
        setupAudioSession()
    }
    
    // MARK: - Audio Session Setup
    private func setupAudioSession() {
        let session = AVAudioSession.sharedInstance()
        
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setPreferredSampleRate(AudioConfig.sampleRate)
            try session.setPreferredIOBufferDuration(0.01) // 10ms buffer
            try session.setActive(true)
            
            print("[Audio] Session configured successfully")
        } catch {
            print("[Audio] Session setup error: \(error.localizedDescription)")
        }
    }
    
    // MARK: - Recording
    func startRecording() {
        guard !isRecording else { return }
        
        audioQueue.async { [weak self] in
            self?.setupAndStartEngine()
        }
    }
    
    private func setupAndStartEngine() {
        audioEngine = AVAudioEngine()
        guard let engine = audioEngine else { return }
        
        inputNode = engine.inputNode
        guard let inputNode = inputNode else { return }
        
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        
        // Convert to 16kHz mono for server
        let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: AudioConfig.sampleRate,
            channels: 1,
            interleaved: true
        )!
        
        // Install tap on input
        inputNode.installTap(onBus: 0, bufferSize: AVAudioFrameCount(AudioConfig.bufferSize), format: recordingFormat) { [weak self] buffer, time in
            self?.processInputBuffer(buffer, format: recordingFormat, targetFormat: targetFormat)
        }
        
        do {
            try engine.start()
            isRecording = true
            print("[Audio] Recording started")
        } catch {
            print("[Audio] Engine start error: \(error.localizedDescription)")
        }
    }
    
    private func processInputBuffer(_ buffer: AVAudioPCMBuffer, format: AVAudioFormat, targetFormat: AVAudioFormat) {
        // Calculate input level for visualization
        let level = calculateLevel(from: buffer)
        DispatchQueue.main.async {
            self.currentInputLevel = level
            self.delegate?.audioService(self, didUpdateInputLevel: level)
        }
        
        // Convert buffer to target format
        guard let convertedBuffer = convertBuffer(buffer, from: format, to: targetFormat) else { return }
        
        // Extract data
        let audioData = bufferToData(convertedBuffer)
        
        DispatchQueue.main.async {
            self.delegate?.audioService(self, didCaptureAudioData: audioData)
        }
    }
    
    private func convertBuffer(_ buffer: AVAudioPCMBuffer, from sourceFormat: AVAudioFormat, to targetFormat: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard let converter = AVAudioConverter(from: sourceFormat, to: targetFormat) else { return nil }
        
        let ratio = targetFormat.sampleRate / sourceFormat.sampleRate
        let outputFrameCount = AVAudioFrameCount(Double(buffer.frameLength) * ratio)
        
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: outputFrameCount) else { return nil }
        
        var error: NSError?
        let inputBlock: AVAudioConverterInputBlock = { inNumPackets, outStatus in
            outStatus.pointee = .haveData
            return buffer
        }
        
        converter.convert(to: outputBuffer, error: &error, withInputFrom: inputBlock)
        
        return outputBuffer
    }
    
    private func bufferToData(_ buffer: AVAudioPCMBuffer) -> Data {
        let audioBuffer = buffer.audioBufferList.pointee.mBuffers
        return Data(bytes: audioBuffer.mData!, count: Int(audioBuffer.mDataByteSize))
    }
    
    private func calculateLevel(from buffer: AVAudioPCMBuffer) -> Float {
        guard let channelData = buffer.floatChannelData else { return 0 }
        
        let channelDataValue = channelData.pointee
        let frameLength = Int(buffer.frameLength)
        
        var sum: Float = 0
        for i in 0..<frameLength {
            sum += abs(channelDataValue[i])
        }
        
        let average = sum / Float(frameLength)
        let db = 20 * log10(average)
        
        // Normalize to 0-1 range (assuming -60 to 0 dB range)
        let normalized = max(0, min(1, (db + 60) / 60))
        return normalized
    }
    
    func stopRecording() {
        guard isRecording else { return }
        
        audioQueue.async { [weak self] in
            self?.inputNode?.removeTap(onBus: 0)
            self?.audioEngine?.stop()
            self?.isRecording = false
            
            DispatchQueue.main.async {
                self?.currentInputLevel = 0
            }
            
            print("[Audio] Recording stopped")
        }
    }
    
    // MARK: - Playback
    func playAudioData(_ data: Data) {
        audioQueue.async { [weak self] in
            self?.audioBuffer.append(data)
            self?.processAudioBuffer()
        }
    }
    
    private func processAudioBuffer() {
        guard !audioBuffer.isEmpty else { return }
        
        let data = audioBuffer.removeFirst()
        
        // Create audio buffer from data
        let format = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: AudioConfig.sampleRate,
            channels: 1,
            interleaved: true
        )!
        
        let frameCount = AVAudioFrameCount(data.count / 2) // 16-bit = 2 bytes per sample
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return }
        
        buffer.frameLength = frameCount
        
        data.withUnsafeBytes { rawBufferPointer in
            let audioBuffer = buffer.audioBufferList.pointee.mBuffers
            memcpy(audioBuffer.mData, rawBufferPointer.baseAddress, data.count)
        }
        
        playBuffer(buffer)
    }
    
    private func playBuffer(_ buffer: AVAudioPCMBuffer) {
        if audioPlayer == nil || audioEngine == nil {
            setupPlaybackEngine()
        }
        
        guard let player = audioPlayer, let engine = audioEngine else { return }
        
        if !engine.isRunning {
            do {
                try engine.start()
            } catch {
                print("[Audio] Playback engine start error: \(error)")
                return
            }
        }
        
        if !isPlaying {
            isPlaying = true
            DispatchQueue.main.async {
                self.delegate?.audioServiceDidStartPlaying(self)
            }
        }
        
        player.scheduleBuffer(buffer) { [weak self] in
            self?.audioQueue.async {
                if self?.audioBuffer.isEmpty == true {
                    self?.isPlaying = false
                    DispatchQueue.main.async {
                        self?.delegate?.audioServiceDidFinishPlaying(self!)
                    }
                } else {
                    self?.processAudioBuffer()
                }
            }
        }
        
        if !player.isPlaying {
            player.play()
        }
    }
    
    private func setupPlaybackEngine() {
        audioEngine = AVAudioEngine()
        audioPlayer = AVAudioPlayerNode()
        
        guard let engine = audioEngine, let player = audioPlayer else { return }
        
        let format = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: AudioConfig.sampleRate,
            channels: 1,
            interleaved: true
        )!
        
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        
        do {
            try engine.start()
            print("[Audio] Playback engine started")
        } catch {
            print("[Audio] Playback setup error: \(error)")
        }
    }
    
    func stopPlayback() {
        audioQueue.async { [weak self] in
            self?.audioBuffer.removeAll()
            self?.audioPlayer?.stop()
            self?.audioEngine?.stop()
            self?.isPlaying = false
            
            DispatchQueue.main.async {
                self?.currentOutputLevel = 0
            }
        }
    }
    
    // MARK: - Permissions
    func requestPermission(completion: @escaping (Bool) -> Void) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                completion(granted)
            }
        }
    }
    
    func hasPermission() -> Bool {
        return AVAudioSession.sharedInstance().recordPermission == .granted
    }
}
