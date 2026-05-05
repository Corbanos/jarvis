//
//  WaveformView.swift
//  JarvisRemote
//
//  Audio waveform visualization with HUD aesthetic
//

import SwiftUI

struct WaveformView: View {
    let levels: [Float]
    let isActive: Bool
    
    @State private var animationPhase: CGFloat = 0
    
    private let barCount = 30
    private let barSpacing: CGFloat = 3
    private let maxBarHeight: CGFloat = 60
    private let minBarHeight: CGFloat = 2
    
    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: barSpacing) {
                ForEach(0..<barCount, id: \.self) { index in
                    WaveformBar(
                        level: index < levels.count ? CGFloat(levels[index]) : 0,
                        isActive: isActive,
                        index: index,
                        animationPhase: animationPhase
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: maxBarHeight)
        }
        .frame(height: maxBarHeight)
        .onAppear {
            withAnimation(.linear(duration: 2).repeatForever(autoreverses: false)) {
                animationPhase = 1
            }
        }
    }
}

struct WaveformBar: View {
    let level: CGFloat
    let isActive: Bool
    let index: Int
    let animationPhase: CGFloat
    
    private let maxHeight: CGFloat = 60
    private let minHeight: CGFloat = 2
    private let barWidth: CGFloat = 3
    
    var body: some View {
        let adjustedLevel = isActive ? max(0.05, level) : idleLevel
        let height = minHeight + (maxHeight - minHeight) * adjustedLevel
        
        RoundedRectangle(cornerRadius: barWidth / 2)
            .fill(barGradient)
            .frame(width: barWidth, height: height)
            .cyanGlow(radius: isActive && level > 0.3 ? 5 : 0)
    }
    
    private var idleLevel: CGFloat {
        // Subtle idle animation
        let phase = (animationPhase + CGFloat(index) * 0.1).truncatingRemainder(dividingBy: 1)
        return 0.05 + 0.03 * sin(phase * .pi * 2)
    }
    
    private var barGradient: LinearGradient {
        LinearGradient(
            gradient: Gradient(colors: [
                isActive ? JarvisColors.cyan : JarvisColors.cyan.opacity(0.3),
                isActive ? JarvisColors.cyan.opacity(0.7) : JarvisColors.cyan.opacity(0.15)
            ]),
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

// MARK: - Circular Waveform (Alternative Style)
struct CircularWaveformView: View {
    let levels: [Float]
    let isActive: Bool
    
    @State private var rotation: Double = 0
    
    private let ringCount = 3
    
    var body: some View {
        ZStack {
            ForEach(0..<ringCount, id: \.self) { ring in
                WaveformRing(
                    levels: levels,
                    isActive: isActive,
                    ringIndex: ring,
                    totalRings: ringCount
                )
                .rotationEffect(.degrees(rotation + Double(ring) * 30))
            }
        }
        .onAppear {
            withAnimation(.linear(duration: 30).repeatForever(autoreverses: false)) {
                rotation = 360
            }
        }
    }
}

struct WaveformRing: View {
    let levels: [Float]
    let isActive: Bool
    let ringIndex: Int
    let totalRings: Int
    
    var body: some View {
        GeometryReader { geometry in
            let size = min(geometry.size.width, geometry.size.height)
            let baseRadius = size * 0.3 + CGFloat(ringIndex) * 15
            
            Path { path in
                let segmentCount = min(levels.count, 30)
                
                for i in 0..<segmentCount {
                    let angle = (Double(i) / Double(segmentCount)) * 2 * .pi - .pi / 2
                    let level = i < levels.count ? CGFloat(levels[i]) : 0
                    let radius = baseRadius + level * 20
                    
                    let x = geometry.size.width / 2 + radius * CGFloat(cos(angle))
                    let y = geometry.size.height / 2 + radius * CGFloat(sin(angle))
                    
                    if i == 0 {
                        path.move(to: CGPoint(x: x, y: y))
                    } else {
                        path.addLine(to: CGPoint(x: x, y: y))
                    }
                }
                path.closeSubpath()
            }
            .stroke(
                JarvisColors.cyan.opacity(isActive ? 0.8 : 0.3),
                lineWidth: 1
            )
        }
    }
}

// MARK: - Preview
struct WaveformView_Previews: PreviewProvider {
    static var previews: some View {
        ZStack {
            JarvisColors.background.ignoresSafeArea()
            
            VStack(spacing: 40) {
                WaveformView(
                    levels: (0..<30).map { _ in Float.random(in: 0...1) },
                    isActive: true
                )
                .frame(height: 60)
                .padding(.horizontal)
                
                WaveformView(
                    levels: Array(repeating: Float(0), count: 30),
                    isActive: false
                )
                .frame(height: 60)
                .padding(.horizontal)
            }
        }
    }
}
