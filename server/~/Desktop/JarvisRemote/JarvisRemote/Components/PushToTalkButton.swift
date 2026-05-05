//
//  PushToTalkButton.swift
//  JarvisRemote
//
//  Arc reactor-inspired push-to-talk button
//

import SwiftUI

struct PushToTalkButton: View {
    let isActive: Bool
    let inputLevel: Float
    let isEnabled: Bool
    let onPress: () -> Void
    let onRelease: () -> Void
    
    @State private var isPressed = false
    @State private var pulseAnimation = false
    @State private var rotationAngle: Double = 0
    
    private let buttonSize: CGFloat = 120
    private let innerRingSize: CGFloat = 100
    private let coreSize: CGFloat = 50
    
    var body: some View {
        ZStack {
            // Outer glow ring
            Circle()
                .stroke(
                    isActive ? JarvisColors.cyan : JarvisColors.cyan.opacity(0.3),
                    lineWidth: 2
                )
                .frame(width: buttonSize + 30, height: buttonSize + 30)
                .scaleEffect(pulseAnimation && isActive ? 1.1 : 1.0)
                .opacity(pulseAnimation && isActive ? 0.5 : 0.8)
            
            // Rotating segments (arc reactor style)
            ForEach(0..<8, id: \.self) { index in
                ArcSegment(
                    startAngle: .degrees(Double(index) * 45 + rotationAngle),
                    endAngle: .degrees(Double(index) * 45 + 30 + rotationAngle)
                )
                .stroke(
                    isActive ? JarvisColors.cyan : JarvisColors.cyan.opacity(0.4),
                    lineWidth: 3
                )
                .frame(width: buttonSize + 10, height: buttonSize + 10)
            }
            
            // Main button circle
            Circle()
                .fill(
                    RadialGradient(
                        gradient: Gradient(colors: [
                            isActive ? JarvisColors.cyan.opacity(0.3) : JarvisColors.backgroundSecondary,
                            JarvisColors.background
                        ]),
                        center: .center,
                        startRadius: 0,
                        endRadius: buttonSize / 2
                    )
                )
                .frame(width: buttonSize, height: buttonSize)
                .overlay(
                    Circle()
                        .stroke(
                            isActive ? JarvisColors.cyan : JarvisColors.cyan.opacity(0.5),
                            lineWidth: 2
                        )
                )
            
            // Inner ring with level indicator
            Circle()
                .trim(from: 0, to: CGFloat(inputLevel))
                .stroke(
                    JarvisColors.cyan,
                    style: StrokeStyle(lineWidth: 4, lineCap: .round)
                )
                .frame(width: innerRingSize, height: innerRingSize)
                .rotationEffect(.degrees(-90))
            
            // Inner ring background
            Circle()
                .stroke(
                    JarvisColors.cyan.opacity(0.2),
                    lineWidth: 4
                )
                .frame(width: innerRingSize, height: innerRingSize)
            
            // Core glow
            Circle()
                .fill(
                    RadialGradient(
                        gradient: Gradient(colors: [
                            isActive ? JarvisColors.cyan : JarvisColors.cyan.opacity(0.5),
                            isActive ? JarvisColors.cyan.opacity(0.3) : JarvisColors.cyan.opacity(0.1),
                            Color.clear
                        ]),
                        center: .center,
                        startRadius: 0,
                        endRadius: coreSize
                    )
                )
                .frame(width: coreSize * 2, height: coreSize * 2)
            
            // Microphone icon
            Image(systemName: isActive ? "waveform" : "mic.fill")
                .font(.system(size: 28, weight: .light))
                .foregroundColor(isActive ? JarvisColors.cyan : JarvisColors.textPrimary)
                .cyanGlow(radius: isActive ? 15 : 5)
        }
        .scaleEffect(isPressed ? 0.95 : 1.0)
        .opacity(isEnabled ? 1.0 : 0.5)
        .animation(.jarvisSpring, value: isPressed)
        .animation(.jarvisPulse, value: pulseAnimation)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard isEnabled && !isPressed else { return }
                    isPressed = true
                    onPress()
                }
                .onEnded { _ in
                    guard isPressed else { return }
                    isPressed = false
                    onRelease()
                }
        )
        .onAppear {
            withAnimation(.linear(duration: 20).repeatForever(autoreverses: false)) {
                rotationAngle = 360
            }
            pulseAnimation = true
        }
    }
}

// MARK: - Arc Segment Shape
struct ArcSegment: Shape {
    let startAngle: Angle
    let endAngle: Angle
    
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) / 2
        
        path.addArc(
            center: center,
            radius: radius,
            startAngle: startAngle,
            endAngle: endAngle,
            clockwise: false
        )
        
        return path
    }
}

// MARK: - Preview
struct PushToTalkButton_Previews: PreviewProvider {
    static var previews: some View {
        ZStack {
            JarvisColors.background.ignoresSafeArea()
            
            VStack(spacing: 50) {
                PushToTalkButton(
                    isActive: false,
                    inputLevel: 0.3,
                    isEnabled: true,
                    onPress: {},
                    onRelease: {}
                )
                
                PushToTalkButton(
                    isActive: true,
                    inputLevel: 0.7,
                    isEnabled: true,
                    onPress: {},
                    onRelease: {}
                )
            }
        }
    }
}
