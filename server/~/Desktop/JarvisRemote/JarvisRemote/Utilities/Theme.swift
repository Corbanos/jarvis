//
//  Theme.swift
//  JarvisRemote
//
//  Stark Industries / JARVIS HUD aesthetic
//

import SwiftUI

// MARK: - Color Palette
struct JarvisColors {
    // Primary dark background
    static let background = Color(hex: "0a0a0f")
    static let backgroundSecondary = Color(hex: "12121a")
    static let backgroundTertiary = Color(hex: "1a1a24")
    
    // Cyan/electric blue - primary accent
    static let cyan = Color(hex: "00d4ff")
    static let cyanDim = Color(hex: "00d4ff").opacity(0.6)
    static let cyanGlow = Color(hex: "00d4ff").opacity(0.3)
    static let cyanSubtle = Color(hex: "00d4ff").opacity(0.1)
    
    // Amber - warnings/secondary
    static let amber = Color(hex: "f5a623")
    static let amberDim = Color(hex: "f5a623").opacity(0.6)
    static let amberGlow = Color(hex: "f5a623").opacity(0.3)
    
    // Status colors
    static let success = Color(hex: "00ff88")
    static let error = Color(hex: "ff3366")
    static let warning = amber
    
    // Text colors
    static let textPrimary = Color.white.opacity(0.95)
    static let textSecondary = Color.white.opacity(0.6)
    static let textTertiary = Color.white.opacity(0.35)
}

// MARK: - Typography
struct JarvisTypography {
    static let largeTitle = Font.system(size: 34, weight: .thin, design: .default)
    static let title = Font.system(size: 28, weight: .light, design: .default)
    static let headline = Font.system(size: 17, weight: .medium, design: .default)
    static let body = Font.system(size: 17, weight: .light, design: .default)
    static let caption = Font.system(size: 13, weight: .light, design: .default)
    static let mono = Font.system(size: 14, weight: .light, design: .monospaced)
    static let monoSmall = Font.system(size: 11, weight: .light, design: .monospaced)
}

// MARK: - Glow Effects
struct GlowModifier: ViewModifier {
    let color: Color
    let radius: CGFloat
    
    func body(content: Content) -> some View {
        content
            .shadow(color: color, radius: radius / 3, x: 0, y: 0)
            .shadow(color: color, radius: radius / 2, x: 0, y: 0)
            .shadow(color: color.opacity(0.5), radius: radius, x: 0, y: 0)
    }
}

extension View {
    func glow(color: Color = JarvisColors.cyan, radius: CGFloat = 10) -> some View {
        modifier(GlowModifier(color: color, radius: radius))
    }
    
    func cyanGlow(radius: CGFloat = 10) -> some View {
        glow(color: JarvisColors.cyanGlow, radius: radius)
    }
    
    func amberGlow(radius: CGFloat = 10) -> some View {
        glow(color: JarvisColors.amberGlow, radius: radius)
    }
}

// MARK: - HUD Border Style
struct HUDBorderModifier: ViewModifier {
    let color: Color
    let lineWidth: CGFloat
    let cornerRadius: CGFloat
    
    func body(content: Content) -> some View {
        content
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(color, lineWidth: lineWidth)
            )
    }
}

extension View {
    func hudBorder(
        color: Color = JarvisColors.cyan.opacity(0.4),
        lineWidth: CGFloat = 1,
        cornerRadius: CGFloat = 8
    ) -> some View {
        modifier(HUDBorderModifier(color: color, lineWidth: lineWidth, cornerRadius: cornerRadius))
    }
}

// MARK: - Color Extension
extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - Animation Presets
extension Animation {
    static let jarvisPulse = Animation.easeInOut(duration: 1.5).repeatForever(autoreverses: true)
    static let jarvisGlow = Animation.easeInOut(duration: 2.0).repeatForever(autoreverses: true)
    static let jarvisSpring = Animation.spring(response: 0.4, dampingFraction: 0.7)
    static let jarvisFade = Animation.easeInOut(duration: 0.3)
}
