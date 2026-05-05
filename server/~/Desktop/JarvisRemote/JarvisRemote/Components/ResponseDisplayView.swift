//
//  ResponseDisplayView.swift
//  JarvisRemote
//
//  Typewriter-style response display with HUD aesthetic
//

import SwiftUI

struct ResponseDisplayView: View {
    let text: String
    let isActive: Bool
    
    @State private var cursorVisible = true
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header line
            HStack {
                Rectangle()
                    .fill(JarvisColors.cyan.opacity(0.5))
                    .frame(width: 20, height: 1)
                
                Text("J.A.R.V.I.S")
                    .font(JarvisTypography.monoSmall)
                    .foregroundColor(JarvisColors.cyan.opacity(0.7))
                    .tracking(2)
                
                Rectangle()
                    .fill(JarvisColors.cyan.opacity(0.5))
                    .frame(height: 1)
            }
            .padding(.bottom, 12)
            
            // Response text
            HStack(alignment: .top, spacing: 0) {
                Text(text)
                    .font(JarvisTypography.body)
                    .foregroundColor(JarvisColors.textPrimary)
                    .lineSpacing(6)
                
                // Blinking cursor
                if isActive {
                    Rectangle()
                        .fill(JarvisColors.cyan)
                        .frame(width: 2, height: 20)
                        .opacity(cursorVisible ? 1 : 0)
                        .padding(.leading, 2)
                }
                
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            
            // Footer line
            HStack {
                Rectangle()
                    .fill(JarvisColors.cyan.opacity(0.3))
                    .frame(height: 1)
                
                if !text.isEmpty {
                    Text("\(text.count) CHARS")
                        .font(JarvisTypography.monoSmall)
                        .foregroundColor(JarvisColors.textTertiary)
                        .tracking(1)
                }
            }
            .padding(.top, 12)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(JarvisColors.backgroundSecondary.opacity(0.5))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(JarvisColors.cyan.opacity(0.2), lineWidth: 1)
                )
        )
        .onAppear {
            withAnimation(.easeInOut(duration: 0.5).repeatForever()) {
                cursorVisible.toggle()
            }
        }
    }
}

// MARK: - Response History View
struct ResponseHistoryView: View {
    let responses: [JarvisResponse]
    
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(responses) { response in
                    ResponseHistoryItem(response: response)
                }
            }
            .padding()
        }
    }
}

struct ResponseHistoryItem: View {
    let response: JarvisResponse
    
    private var timeString: String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: response.timestamp)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "message")
                    .font(.system(size: 10))
                    .foregroundColor(JarvisColors.cyan.opacity(0.6))
                
                Text(timeString)
                    .font(JarvisTypography.monoSmall)
                    .foregroundColor(JarvisColors.textTertiary)
                
                Spacer()
            }
            
            Text(response.text)
                .font(JarvisTypography.body)
                .foregroundColor(JarvisColors.textSecondary)
                .lineLimit(3)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(JarvisColors.backgroundTertiary)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(JarvisColors.cyan.opacity(0.1), lineWidth: 1)
                )
        )
    }
}

// MARK: - Empty State View
struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 16) {
            // Arc reactor icon
            ZStack {
                Circle()
                    .stroke(JarvisColors.cyan.opacity(0.2), lineWidth: 2)
                    .frame(width: 80, height: 80)
                
                Circle()
                    .stroke(JarvisColors.cyan.opacity(0.3), lineWidth: 1)
                    .frame(width: 60, height: 60)
                
                Circle()
                    .fill(JarvisColors.cyan.opacity(0.1))
                    .frame(width: 40, height: 40)
                
                Image(systemName: "waveform.circle")
                    .font(.system(size: 24, weight: .thin))
                    .foregroundColor(JarvisColors.cyan.opacity(0.5))
            }
            
            Text("AWAITING COMMAND")
                .font(JarvisTypography.caption)
                .foregroundColor(JarvisColors.textTertiary)
                .tracking(2)
        }
    }
}

// MARK: - Preview
struct ResponseDisplayView_Previews: PreviewProvider {
    static var previews: some View {
        ZStack {
            JarvisColors.background.ignoresSafeArea()
            
            VStack(spacing: 30) {
                ResponseDisplayView(
                    text: "Good evening, sir. I've analyzed the data you requested. The results show a 23% increase in efficiency.",
                    isActive: true
                )
                .padding(.horizontal)
                
                EmptyStateView()
            }
        }
    }
}
