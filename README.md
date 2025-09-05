<img src="/src/assets/logo.png" alt="uwu" width="200"/>

# Cheating Daddy

> [!NOTE]  
> Use latest MacOS and Windows version, older versions have limited support

> [!NOTE]  
> During testing it wont answer if you ask something, you need to simulate interviewer asking question, which it will answer

A real-time AI assistant that provides contextual help during video calls, interviews, presentations, and meetings using screen capture and audio analysis.

## Features

- **Live AI Assistance**: Real-time help powered by Google Gemini 2.0 Flash Live
- **Screen & Audio Capture**: Analyzes what you see and hear for contextual responses
- **Multiple Profiles**: Interview, Sales Call, Business Meeting, Presentation, Negotiation
- **Transparent Overlay**: Always-on-top window that can be positioned anywhere
- **Click-through Mode**: Make window transparent to clicks when needed
- **Cross-platform**: Works on macOS, Windows, and Linux (kinda, dont use, just for testing rn)

## Setup

1. **Get a Gemini API Key**: Visit [Google AI Studio](https://aistudio.google.com/apikey)
2. **Copy the Example Environment File**: `cp .env.example .env` and add your `GEMINI_API_KEY`
3. **Install Dependencies**: `npm install`
4. **Run the App**: `npm start` (starts backend and desktop client)

## Usage

1. Enter your Gemini API key in the main window
2. Choose your profile and language in settings
3. Click "Start Session" to begin
4. Position the window using keyboard shortcuts
5. The AI will provide real-time assistance based on your screen and what interview asks

## Keyboard Shortcuts

- **Window Movement**: `Ctrl/Cmd + Arrow Keys` - Move window
- **Click-through**: `Ctrl/Cmd + M` - Toggle mouse events
- **Close/Back**: `Ctrl/Cmd + \` - Close window or go back
- **Send Message**: `Enter` - Send text to AI

## Audio Capture

- **macOS**: [SystemAudioDump](https://github.com/Mohammed-Yasin-Mulla/Sound) for system audio
- **Windows**: Loopback audio capture
- **Linux**: Microphone input

## Requirements

- Electron-compatible OS (macOS, Windows, Linux)
- Gemini API key
- Screen recording permissions
- Microphone/audio permissions

## Real-Time Streaming

Cheating Daddy can stream microphone audio and periodic screen captures to a
backend for live model interaction. The following sections outline the
requirements and configuration for this feature.

### Audio Requirements

- A working microphone is required for live audio capture.
- Optional system audio streaming on macOS relies on the
  [`SystemAudioDump`](https://github.com/Mohammed-Yasin-Mulla/Sound) binary. If
  the tool is missing, install it and ensure it is in your `PATH`.

### Screen Capture

- Grant screen-recording permissions to the application when prompted.
- By default, the screen is captured at **1 frame per second** as JPEG images
  using the browser's default quality settings.

### Configuration

#### Environment Variables

| Variable         | Description                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `APP_NAME`       | Human-readable name exposed by helper processes. Defaults to `Cheating Daddy`.              |
| `AUTH_TOKEN`     | Secret token required by the backend to authorize live streaming connections.               |
| `ALLOWED_ORIGINS`| Comma-separated list of origins permitted to open live WebSocket connections.               |

#### IPC Channels

| Channel               | Direction            | Description                                   |
| --------------------- | -------------------- | --------------------------------------------- |
| `start-live-stream`   | Renderer → Main      | Begin capturing audio and screen frames.      |
| `stop-live-stream`    | Renderer → Main      | Stop the active live streaming session.       |
| `live-stream-status`  | Main → Renderer      | Emits updates about streaming status changes. |
| `live-stream-error`   | Main → Renderer      | Reports errors encountered during streaming.  |

### Troubleshooting

- **`SystemAudioDump` not found (macOS):** Install the binary and verify it is
  accessible via your `PATH`. Without it, system audio cannot be captured.
