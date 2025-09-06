<img src="/src/assets/logo.png" alt="uwu" width="200"/>

# Sales Wizard

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
- Screen frames are streamed in real-time using WebP compression. Capture
  quality and region (full screen, around cursor, or active window) can be
  adjusted in the application settings.

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

## Backend History Server

The application persists conversation history and user-provided context through a lightweight Express server. Start the server independently for development or debugging:

```bash
node backend/server.js
# or via npm script
npm run start:backend
```

By default the server listens on port 3001 (or the value of the `PORT` environment variable).

## API Endpoints

### `/history`

- `GET /history` – returns an array of saved conversation sessions (ID, timestamp, preview).
- `GET /history/:sessionId` – returns the full conversation for a session.
- `POST /history/:sessionId/turn` – append a conversation turn by posting JSON with `transcription` and `ai_response` fields.
- `DELETE /history` – clears all stored conversation sessions.
- `PUT /history/limit` – sets the maximum number of sessions to retain; older sessions are pruned automatically.

### `/context-params`

- `GET /context-params` – retrieves the current context parameters used to prime the model.
- `POST /context-params` – replace the stored context parameters. Provide `{ params: "..." }` in the request body.

## UI Walkthrough

### History tab

Accessible from the app header, the History tab lists past sessions on the left and shows the full transcript when a session is selected. Use the back button to return to the sessions list, the download button to save a session, or the clear button to remove all history. The maximum number of stored sessions can be configured in Advanced settings.

### Context Parameters box

During onboarding or customization, a text area labeled "Context Parameters" allows you to paste résumé details, job descriptions, or other relevant context. The content is saved locally and sent with every new session.

### Troubleshooting

- **`SystemAudioDump` not found (macOS):** Install the binary and verify it is
  accessible via your `PATH`. Without it, system audio cannot be captured.
- **Clear local cache:** Remove the application's local data (for example, via the "Clear Data" option or by clearing `localStorage`) if sessions or settings appear out of sync.
- **Offline mode:** History and context synchronization require network access. If you lose connectivity, the app operates in a degraded offline mode; restore your connection and restart the session to resume normal operation.
