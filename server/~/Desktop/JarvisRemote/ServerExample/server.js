/**
 * Example Jarvis Voice Server
 * 
 * This is a reference implementation showing how to handle
 * WebSocket connections from the JarvisRemote iOS app.
 * 
 * Install dependencies:
 *   npm install express ws
 * 
 * Run:
 *   node server.js
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/voice' });

const PORT = 3456;

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'jarvis-voice' });
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('[WS] Client connected from:', req.socket.remoteAddress);
  
  let audioBuffer = [];
  let isReceivingAudio = false;
  
  ws.on('message', async (data, isBinary) => {
    if (isBinary) {
      // Received audio data
      if (isReceivingAudio) {
        audioBuffer.push(data);
      }
    } else {
      // Received JSON message
      try {
        const message = JSON.parse(data.toString());
        handleMessage(ws, message, audioBuffer);
      } catch (e) {
        console.error('[WS] Invalid JSON:', e.message);
      }
    }
  });
  
  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('[WS] Error:', error.message);
  });
  
  // Send welcome status
  sendMessage(ws, {
    type: 'status',
    payload: { status: 'connected' }
  });
});

function handleMessage(ws, message, audioBuffer) {
  console.log('[WS] Received:', message.type);
  
  switch (message.type) {
    case 'audio_start':
      audioBuffer.length = 0; // Clear buffer
      console.log('[WS] Audio stream started');
      break;
      
    case 'audio_end':
      console.log('[WS] Audio stream ended, received', audioBuffer.length, 'chunks');
      processAudio(ws, audioBuffer);
      audioBuffer.length = 0;
      break;
      
    case 'ping':
      sendMessage(ws, { type: 'pong' });
      break;
      
    default:
      console.log('[WS] Unknown message type:', message.type);
  }
}

async function processAudio(ws, audioChunks) {
  // Combine audio chunks
  const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const audioData = Buffer.concat(audioChunks, totalLength);
  
  console.log('[Process] Total audio data:', audioData.length, 'bytes');
  
  // Send processing status
  sendMessage(ws, {
    type: 'status',
    payload: { status: 'processing' }
  });
  
  // ============================================
  // TODO: Replace this section with actual implementation:
  //
  // 1. Speech-to-Text (STT)
  //    const transcript = await whisper.transcribe(audioData);
  //
  // 2. Process with Jarvis
  //    const response = await jarvis.process(transcript);
  //
  // 3. Text-to-Speech (TTS)
  //    const audioResponse = await tts.synthesize(response.text);
  //
  // 4. Stream audio back to client
  //    ws.send(audioResponse, { binary: true });
  // ============================================
  
  // Example: Send mock response
  setTimeout(() => {
    // Send text response
    sendMessage(ws, {
      type: 'text_response',
      payload: { 
        text: "Good evening, sir. I've received your voice command and processed it successfully. The audio stream contained " + 
              (audioData.length / 1024).toFixed(1) + " KB of data. How may I assist you further?"
      }
    });
    
    // In a real implementation, you would also send audio:
    // ws.send(audioBuffer, { binary: true });
    
  }, 1000);
}

function sendMessage(ws, message) {
  message.timestamp = new Date().toISOString();
  ws.send(JSON.stringify(message));
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║              JARVIS VOICE SERVER                          ║
╠═══════════════════════════════════════════════════════════╣
║  WebSocket: ws://0.0.0.0:${PORT}/ws/voice                    ║
║  Health:    http://0.0.0.0:${PORT}/health                    ║
╚═══════════════════════════════════════════════════════════╝

Waiting for connections...
  `);
});
