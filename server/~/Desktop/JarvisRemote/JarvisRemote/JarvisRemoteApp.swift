//
//  JarvisRemoteApp.swift
//  JarvisRemote
//
//  Created by Jarvis System
//  A remote tunnel client for the Jarvis AI assistant
//

import SwiftUI

@main
struct JarvisRemoteApp: App {
    @StateObject private var jarvisService = JarvisService()
    
    var body: some Scene {
        WindowGroup {
            MainView()
                .environmentObject(jarvisService)
                .preferredColorScheme(.dark)
        }
    }
}
