# Cheating Daddy

A real-time AI assistant overlay powered by Google's Gemini Live API.

## Features
- Real-time voice, screen bursts, and text via Gemini Live
- Always-on-top transparent HUD overlay
- Push-to-talk, screen capture, and interrupt controls

## Setup
1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Create `.env` with:
```
GEMINI_API_KEY=your_key
PORT=3001
```
3. Install deps and start in Electron mode:
```
npm install
npm run dev:electron
```

## Scripts
- `npm run dev` – start backend and Vite dev server
- `npm run dev:electron` – backend and Electron renderer
- `npm run build` – build and package app
- `npm test` – run Playwright tests

## License
GPL-3.0
