//
//  MainView.swift
//  JarvisRemote
//
//  Main interface with HUD aesthetic
//

import SwiftUI

struct MainView: View {
    @EnvironmentObject var jarvisService: JarvisService
    @State private var showSettings = false
    @State private var showHistory = false
    
    var body: some View {
        ZStack {
            // Background
            backgroundView
            
            // Main content
            VStack(spacing: 0) {
                // Top bar
                topBar
                
                Spacer()
                
                // Response area
                responseArea
                
                Spacer()
                
                // Waveform visualization
                waveformArea
                
                // Push-to-talk button
                buttonArea
                
                // Bottom spacer for safe area
                Spacer()
                    .frame(height: 20)
            }
            .padding(.horizontal, 20)
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(jarvisService)
        }
        .sheet(isPresented: $showHistory) {
            historySheet
        }
        .onAppear {
            jarvisService.checkAudioPermission()
        }
    }
    
    // MARK: - Background
    private var backgroundView: some View {
        ZStack {
            JarvisColors.background
                .ignoresSafeArea()
            
            // Subtle grid pattern
            GridPatternView()
                .opacity(0.03)
            
            // Corner accents
            VStack {
                HStack {
                    CornerAccent(corner: .topLeft)
                    Spacer()
                    CornerAccent(corner: .topRight)
                }
                Spacer()
                HStack {
                    CornerAccent(corner: .bottomLeft)
                    Spacer()
                    CornerAccent(corner: .bottomRight)
                }
            }
            .padding(10)
        }
    }
    
    // MARK: - Top Bar
    private var topBar: some View {
        HStack {
            // Settings button
            Button(action: { showSettings = true }) {
                Image(systemName: "gearshape")
                    .font(.system(size: 20, weight: .light))
                    .foregroundColor(JarvisColors.cyan.opacity(0.7))
                    .frame(width: 44, height: 44)
            }
            
            Spacer()
            
            // Connection status
            ConnectionStatusView(state: jarvisService.connectionState)
            
            Spacer()
            
            // History button
            Button(action: { showHistory = true }) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 20, weight: .light))
                    .foregroundColor(JarvisColors.cyan.opacity(0.7))
                    .frame(width: 44, height: 44)
            }
        }
        .padding(.top, 10)
    }
    
    // MARK: - Response Area
    private var responseArea: some View {
        VStack(spacing: 20) {
            if jarvisService.currentResponse.isEmpty {
                EmptyStateView()
                    .frame(height: 200)
            } else {
                ResponseDisplayView(
                    text: jarvisService.currentResponse,
                    isActive: jarvisService.voiceState == .speaking ||
                              jarvisService.voiceState == .processing
                )
            }
            
            // Voice state indicator
            VoiceStateIndicator(state: jarvisService.voiceState)
        }
    }
    
    // MARK: - Waveform Area
    private var waveformArea: some View {
        VStack(spacing: 8) {
            if jarvisService.voiceState == .speaking {
                WaveformView(
                    levels: jarvisService.outputLevels,
                    isActive: true
                )
                .frame(height: 60)
                .transition(.opacity.combined(with: .scale(scale: 0.8)))
            } else {
                WaveformView(
                    levels: Array(repeating: Float(0), count: 30),
                    isActive: false
                )
                .frame(height: 60)
            }
        }
        .animation(.jarvisFade, value: jarvisService.voiceState)
        .padding(.bottom, 20)
    }
    
    // MARK: - Button Area
    private var buttonArea: some View {
        VStack(spacing: 16) {
            PushToTalkButton(
                isActive: jarvisService.voiceState == .listening,
                inputLevel: jarvisService.inputLevel,
                isEnabled: jarvisService.connectionState.isConnected && jarvisService.hasAudioPermission,
                onPress: {
                    jarvisService.startListening()
                },
                onRelease: {
                    jarvisService.stopListening()
                }
            )
            
            // Instructions
            Text(instructionText)
                .font(JarvisTypography.caption)
                .foregroundColor(JarvisColors.textTertiary)
                .multilineTextAlignment(.center)
        }
        .padding(.bottom, 20)
    }
    
    private var instructionText: String {
        if !jarvisService.hasAudioPermission {
            return "TAP TO GRANT MICROPHONE ACCESS"
        } else if !jarvisService.connectionState.isConnected {
            return "CONNECT TO SERVER IN SETTINGS"
        } else {
            return "HOLD TO SPEAK"
        }
    }
    
    // MARK: - History Sheet
    private var historySheet: some View {
        NavigationView {
            ZStack {
                JarvisColors.background.ignoresSafeArea()
                
                if jarvisService.responseHistory.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "text.bubble")
                            .font(.system(size: 40, weight: .thin))
                            .foregroundColor(JarvisColors.textTertiary)
                        
                        Text("No conversation history")
                            .font(JarvisTypography.body)
                            .foregroundColor(JarvisColors.textTertiary)
                    }
                } else {
                    ResponseHistoryView(responses: jarvisService.responseHistory)
                }
            }
            .navigationTitle("History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        showHistory = false
                    }
                    .foregroundColor(JarvisColors.cyan)
                }
            }
        }
    }
}

// MARK: - Corner Accent
struct CornerAccent: View {
    enum Corner {
        case topLeft, topRight, bottomLeft, bottomRight
    }
    
    let corner: Corner
    private let size: CGFloat = 30
    private let thickness: CGFloat = 1
    
    var body: some View {
        ZStack {
            // Horizontal line
            Rectangle()
                .fill(JarvisColors.cyan.opacity(0.3))
                .frame(width: size, height: thickness)
                .offset(x: horizontalOffset, y: 0)
            
            // Vertical line
            Rectangle()
                .fill(JarvisColors.cyan.opacity(0.3))
                .frame(width: thickness, height: size)
                .offset(x: 0, y: verticalOffset)
        }
        .frame(width: size, height: size)
    }
    
    private var horizontalOffset: CGFloat {
        switch corner {
        case .topLeft, .bottomLeft: return size / 2 - thickness / 2
        case .topRight, .bottomRight: return -(size / 2 - thickness / 2)
        }
    }
    
    private var verticalOffset: CGFloat {
        switch corner {
        case .topLeft, .topRight: return size / 2 - thickness / 2
        case .bottomLeft, .bottomRight: return -(size / 2 - thickness / 2)
        }
    }
}

// MARK: - Grid Pattern
struct GridPatternView: View {
    var body: some View {
        GeometryReader { geometry in
            Path { path in
                let spacing: CGFloat = 40
                let width = geometry.size.width
                let height = geometry.size.height
                
                // Vertical lines
                for x in stride(from: 0, to: width, by: spacing) {
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: height))
                }
                
                // Horizontal lines
                for y in stride(from: 0, to: height, by: spacing) {
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: width, y: y))
                }
            }
            .stroke(JarvisColors.cyan, lineWidth: 0.5)
        }
    }
}

// MARK: - Preview
struct MainView_Previews: PreviewProvider {
    static var previews: some View {
        MainView()
            .environmentObject(JarvisService())
    }
}
