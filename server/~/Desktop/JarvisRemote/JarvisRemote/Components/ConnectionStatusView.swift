//
//  ConnectionStatusView.swift
//  JarvisRemote
//
//  HUD-style connection status indicator
//

import SwiftUI

struct ConnectionStatusView: View {
    let state: ConnectionState
    
    @State private var pulseAnimation = false
    
    var body: some View {
        HStack(spacing: 8) {
            // Status indicator dot
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
                .overlay(
                    Circle()
                        .stroke(statusColor.opacity(0.5), lineWidth: 1)
                        .scaleEffect(pulseAnimation ? 2 : 1)
                        .opacity(pulseAnimation ? 0 : 0.8)
                )
                .glow(color: statusColor.opacity(0.5), radius: 5)
            
            // Status text
            Text(state.displayText)
                .font(JarvisTypography.monoSmall)
                .foregroundColor(statusColor)
                .tracking(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(JarvisColors.backgroundSecondary)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(statusColor.opacity(0.3), lineWidth: 1)
                )
        )
        .onAppear {
            if case .connected = state {
                withAnimation(.jarvisPulse) {
                    pulseAnimation = true
                }
            }
        }
        .onChange(of: state) { newState in
            if case .connected = newState {
                withAnimation(.jarvisPulse) {
                    pulseAnimation = true
                }
            } else {
                pulseAnimation = false
            }
        }
    }
    
    private var statusColor: Color {
        switch state {
        case .connected:
            return JarvisColors.success
        case .connecting, .reconnecting:
            return JarvisColors.amber
        case .disconnected:
            return JarvisColors.textTertiary
        case .error:
            return JarvisColors.error
        }
    }
}

// MARK: - Voice State Indicator
struct VoiceStateIndicator: View {
    let state: VoiceState
    
    @State private var dotAnimation = false
    
    var body: some View {
        HStack(spacing: 6) {
            // Animated dots for processing
            if state == .processing {
                HStack(spacing: 4) {
                    ForEach(0..<3, id: \.self) { index in
                        Circle()
                            .fill(JarvisColors.cyan)
                            .frame(width: 6, height: 6)
                            .scaleEffect(dotAnimation ? 1.2 : 0.8)
                            .animation(
                                .easeInOut(duration: 0.6)
                                    .repeatForever()
                                    .delay(Double(index) * 0.2),
                                value: dotAnimation
                            )
                    }
                }
            } else {
                Image(systemName: iconName)
                    .font(.system(size: 12, weight: .light))
                    .foregroundColor(stateColor)
            }
            
            Text(state.displayText)
                .font(JarvisTypography.monoSmall)
                .foregroundColor(stateColor)
                .tracking(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(JarvisColors.backgroundSecondary)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(stateColor.opacity(0.3), lineWidth: 1)
                )
        )
        .onAppear {
            dotAnimation = true
        }
    }
    
    private var iconName: String {
        switch state {
        case .idle:
            return "circle"
        case .listening:
            return "waveform"
        case .processing:
            return "ellipsis"
        case .speaking:
            return "speaker.wave.2"
        }
    }
    
    private var stateColor: Color {
        switch state {
        case .idle:
            return JarvisColors.textTertiary
        case .listening:
            return JarvisColors.cyan
        case .processing:
            return JarvisColors.amber
        case .speaking:
            return JarvisColors.cyan
        }
    }
}

// MARK: - Preview
struct ConnectionStatusView_Previews: PreviewProvider {
    static var previews: some View {
        ZStack {
            JarvisColors.background.ignoresSafeArea()
            
            VStack(spacing: 20) {
                ConnectionStatusView(state: .connected)
                ConnectionStatusView(state: .connecting)
                ConnectionStatusView(state: .disconnected)
                ConnectionStatusView(state: .error("Network timeout"))
                
                Divider()
                    .background(JarvisColors.cyan.opacity(0.3))
                
                VoiceStateIndicator(state: .idle)
                VoiceStateIndicator(state: .listening)
                VoiceStateIndicator(state: .processing)
                VoiceStateIndicator(state: .speaking)
            }
            .padding()
        }
    }
}
