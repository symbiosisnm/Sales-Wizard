/*
 * Voice assistant helper for Cheating Daddy.
 *
 * This module provides a simple wrapper around the browser's Web Speech
 * API (SpeechRecognition) to continuously listen for speech, convert it
 * to text, and invoke a callback with finalised transcripts. It returns
 * a function that can be called to stop listening.
 *
 * Usage:
 *
 * import { startListening } from './utils/voiceAssistant.js';
 * const stop = startListening(transcript => {
 *   console.log('You said:', transcript);
 * });
 *
 * // Later, when you want to stop listening:
 * stop();
 */

export function startListening(onTranscript) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('SpeechRecognition API is not available in this environment');
    return () => {};
  }
  const recognizer = new SpeechRecognition();
  recognizer.continuous = true;
  recognizer.interimResults = false;
  recognizer.lang = 'en-US';

  recognizer.onresult = event => {
    const result = event.results[event.results.length - 1];
    if (result.isFinal) {
      const transcript = result[0].transcript.trim();
      if (transcript) {
        try {
          onTranscript(transcript);
        } catch (err) {
          console.error('Error in transcript callback:', err);
        }
      }
    }
  };

  recognizer.onerror = event => {
    console.error('Speech recognition error:', event.error);
  };

  recognizer.onend = () => {
    // Restart automatically if stopped unexpectedly
    recognizer.start();
  };

  recognizer.start();
  return () => recognizer.stop();
}