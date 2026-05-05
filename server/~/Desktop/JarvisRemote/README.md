# Jarvis Remote

A native iOS app that acts as a remote tunnel/client for the Jarvis AI assistant system. The app features a Tony Stark / Iron Man / J.A.R.V.I.S. aesthetic with dark backgrounds, cyan accents, and HUD-style elements.

## Features

- **Push-to-Talk Voice Control**: Large, glowing arc reactor-style button for voice input
- **Real-time Audio Streaming**: Audio captured on phone → streamed to server → STT → processed → TTS → streamed back
- **Typewriter Text Display**: Jarvis responses appear with a classic typewriter effect
- **Waveform Visualization**: Audio visualization when Jarvis speaks
- **Connection Management**: Auto-reconnect logic with status indicators
- **JARVIS HUD Aesthetic**: Dark theme with cyan/electric blue accents

## Requirements

- iOS 16.0+
- Xcode 15.0+
- macOS running the Jarvis server
- Both devices on the same network (or server accessible via internet)

## Installation

### 1. Open the Project

```bash
cd ~/Desktop/JarvisRemote
open JarvisRemote.xcodeproj
```

### 2. Configure Signing

1. Select the project in Xcode's navigator
2. Select the "JarvisRemote" target
3. Under "Signing & Capabilities", select your development team
4. Change the bundle identifier if needed (e.g., `com.yourname.jarvisremote`)

### 3. Build and Run

1. Connect your iPhone or select a simulator
2. Press `Cmd+R` to build and run

### 4. Configure Server Connection

1. Open the app
2. Tap the gear icon (⚙️) in the top-left
3. Enter your Jarvis server's IP address and port
4. Tap "Test Connection" to verify
5. Tap "Connect"

## Server Requirements

Your Jarvis server needs to expose a WebSocket endpoint that handles:

### WebSocket Endpoint: `/ws/voice`

**Messages from Client (iOS App):**

```json
// Audio stream start
{"type": "audio_start", "timestamp": "2024-01-01T00:00:00Z"}

// Audio data (raw PCM 16-bit, 16kHz, mono)
// Sent as binary WebSocket messages

// Audio stream end
{"type": "audio_end", "timestamp": "2024-01-01T00:00:00Z"}
```

**Messages to Client:**

```json
// Partial text (during processing)
{"type": "text_partial", "payload": {"text": "I'm analyzing..."}, "timestamp": "..."}

// Final text response
{"type": "text_response", "payload": {"text": "Here's what I found..."}, "timestamp": "..."}

// Audio response (TTS output)
// Sent as binary WebSocket messages (PCM 16-bit, 16kHz, mono)

// Status updates
{"type": "status", "payload": {"status": "processing"}, "timestamp": "..."}

// Errors
{"type": "error", "payload": {"errorMessage": "..."}, "timestamp": "..."}
```

### Health Check Endpoint: `GET /health`

Returns `200 OK` when server is running (used for connection testing).

## Example Server Implementation (Node.js)

See `ServerExample/server.js` for a reference implementation.

## Architecture

```
┌─────────────────────┐     WebSocket      ┌─────────────────────┐
│    iOS App          │◄──────────────────►│   Jarvis Server     │
│                     │                    │                     │
│  ┌───────────────┐  │    Audio (PCM)     │  ┌───────────────┐  │
│  │ AudioService  │──┼───────────────────►│  │ STT (Whisper) │  │
│  └───────────────┘  │                    │  └───────┬───────┘  │
│                     │                    │          │          │
│  ┌───────────────┐  │    Audio (PCM)     │  ┌───────▼───────┐  │
│  │ AVAudioPlayer │◄─┼────────────────────┤  │  TTS Engine   │  │
│  └───────────────┘  │                    │  └───────┬───────┘  │
│                     │                    │          │          │
│  ┌───────────────┐  │      JSON          │  ┌───────▼───────┐  │
│  │ UI (SwiftUI)  │◄─┼────────────────────┤  │ Jarvis Core   │  │
│  └───────────────┘  │                    │  └───────────────┘  │
└─────────────────────┘                    └─────────────────────┘
```

## Audio Format

- **Sample Rate**: 16,000 Hz
- **Channels**: 1 (Mono)
- **Bit Depth**: 16-bit signed integer (PCM)
- **Encoding**: Raw PCM (no compression)

## Project Structure

```
JarvisRemote/
├── JarvisRemote.xcodeproj/
├── JarvisRemote/
│   ├── JarvisRemoteApp.swift       # App entry point
│   ├── Info.plist                   # App configuration
│   ├── Views/
│   │   ├── MainView.swift           # Main interface
│   │   └── SettingsView.swift       # Server configuration
│   ├── Components/
│   │   ├── PushToTalkButton.swift   # Arc reactor button
│   │   ├── WaveformView.swift       # Audio visualization
│   │   ├── ConnectionStatusView.swift
│   │   └── ResponseDisplayView.swift
│   ├── Services/
│   │   ├── JarvisService.swift      # Main coordinator
│   │   ├── WebSocketService.swift   # WebSocket connection
│   │   └── AudioService.swift       # Audio capture/playback
│   ├── Models/
│   │   └── JarvisModels.swift       # Data models
│   ├── Utilities/
│   │   └── Theme.swift              # Colors, fonts, effects
│   └── Assets.xcassets/
├── ServerExample/                    # Example server code
└── README.md
```

## Design System

### Colors

| Name | Hex | Usage |
|------|-----|-------|
| Background | `#0a0a0f` | Primary background |
| Cyan | `#00d4ff` | Primary accent, active states |
| Amber | `#f5a623` | Warnings, secondary accent |
| Success | `#00ff88` | Connected, success states |
| Error | `#ff3366` | Errors, disconnected |

### Typography

- **Large Title**: SF Pro, 34pt, Thin
- **Headline**: SF Pro, 17pt, Medium
- **Body**: SF Pro, 17pt, Light
- **Monospace**: SF Mono, 14pt, Light (for status text)

## Troubleshooting

### "Cannot connect to server"

1. Ensure both devices are on the same network
2. Check firewall settings on the Mac
3. Verify the IP address and port are correct
4. Try using the Mac's `.local` hostname

### "Microphone access denied"

1. Go to iOS Settings → JarvisRemote → Microphone
2. Enable microphone access
3. Restart the app

### Audio quality issues

- Ensure a stable Wi-Fi connection
- Move closer to the router
- Check for network congestion

## License

MIT License - Use freely for personal and commercial projects.

## Credits

Inspired by the J.A.R.V.I.S. AI from Marvel's Iron Man films.

---

*"I am not a robot. I am an AI, and a rather sophisticated one at that."* — J.A.R.V.I.S.
