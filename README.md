<img src="/src/assets/logo.png" alt="uwu" width="200"/>

# Sales Wizard

> [!NOTE]  
> Use latest MacOS and Windows version, older versions have limited support

A real-time OpenAI assistant that provides contextual help during calls, support work, sales conversations, demos, troubleshooting, interviews, presentations, and meetings using screen capture, audio analysis, web search, and saved knowledge.

## Features

- **Live AI Assistance**: Real-time help powered by OpenAI Realtime
- **Screen & Audio Capture**: Analyzes what you see and hear for contextual responses
- **OpenAI Web Search**: Grounds freshness-sensitive answers with current web results and sources
- **Knowledge Library**: Save guidelines, pages, images, and videos for task-specific retrieval
- **Video Assist**: Uses bundled FFmpeg tooling to sample imported videos and short rolling screen clips
- **Multiple Profiles**: General, Sales Call, Support, Business Meeting, Presentation, Negotiation, Interview
- **Transparent Overlay**: Always-on-top window that can be positioned anywhere
- **Click-through Mode**: Make window transparent to clicks when needed
- **Cross-platform**: Works on macOS, Windows, and Linux (kinda, dont use, just for testing rn)

## Setup

1. **Get an OpenAI API Key**: Visit [OpenAI API keys](https://platform.openai.com/api-keys)
2. **Copy the Example Environment File**: `cp .env.example .env` and add your `OPENAI_API_KEY`
3. **Install Dependencies**: `npm install`
4. **Run the App**: `npm start` (starts backend and desktop client)

## Usage

1. Enter your OpenAI API key in the main window
2. Set the task purpose, target outcome, guidelines, knowledge, and web-search preference
3. Click "Start Session" to begin
4. Position the window using keyboard shortcuts
5. The AI will provide real-time assistance based on your screen, audio, knowledge, and current web context

## Keyboard Shortcuts

- **Window Movement**: `Ctrl/Cmd + Arrow Keys` - Move window
- **Click-through**: `Ctrl/Cmd + M` - Toggle mouse events
- **Close/Back**: `Ctrl/Cmd + \` - Close window or go back
- **Send Message**: `Enter` - Send text to AI

## Audio Capture

- Microphone input is supported through browser media capture.
- Optional system audio is requested during screen share when the platform/share target supports it.
- If system audio is unavailable, the session continues with microphone audio and live screen frames.

## Requirements

- Electron-compatible OS (macOS, Windows, Linux)
- OpenAI API key
- Screen recording permissions
- Microphone/audio permissions

## Real-Time Streaming

Sales Wizard can stream microphone audio and periodic screen captures to a
backend for OpenAI Realtime model interaction. The following sections outline the
requirements and configuration for this feature.

### Audio Requirements

- A working microphone is required for live audio capture.
- Optional system audio capture depends on the current OS and the selected screen/share target.

### Screen Capture

- Grant screen-recording permissions to the application when prompted.
- Screen frames are streamed in real-time using JPEG compression. Capture
  quality and region (full screen, around cursor, or active window) can be
  adjusted in the application settings.

### Configuration

#### Environment Variables

| Variable         | Description                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `APP_NAME`       | Human-readable name exposed by helper processes. Defaults to `Sales Wizard`.                |
| `OPENAI_API_KEY` | Default API key used by the local backend when the desktop client does not pass one.        |
| `OPENAI_REALTIME_MODEL` | Optional override for the realtime model. Defaults to `gpt-realtime-2`.            |
| `OPENAI_TEXT_MODEL` | Optional override for one-shot text requests. Defaults to `gpt-5.4-mini`.                |

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
