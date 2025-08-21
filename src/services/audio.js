/**
 * Audio transcription service for Cheating Daddy.
 * Uses the Web Speech API when available, otherwise records a short
 * snippet from the microphone and sends it to a third‑party API
 * (OpenAI Whisper) for transcription.
 *
 * Returns the transcription text or an empty string if transcription fails.
 */
export async function transcribeAudio() {
  try {
    // Prefer browser built‑in speech recognition if available
    const SpeechRecognition =
      typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);

    if (SpeechRecognition) {
      return await new Promise((resolve, reject) => {
        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onresult = (e) =>
          resolve(e.results[0] && e.results[0][0] ? e.results[0][0].transcript : '');
        recognition.onerror = (e) => reject(new Error(e.error || 'Speech recognition error'));
        recognition.start();
      });
    }

    // Fallback: record audio and send to OpenAI Whisper
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      throw new Error('No speech recognition capability');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];

    return await new Promise((resolve, reject) => {
      recorder.ondataavailable = (e) => e.data && chunks.push(e.data);
      recorder.onerror = (e) => reject(e.error || e);
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const form = new FormData();
          form.append('file', blob, 'speech.webm');
          form.append('model', 'whisper-1');

          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) throw new Error('Missing OpenAI API key');

          const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error('Transcription API error: ' + res.status + ' ' + text);
          }

          const data = await res.json();
          resolve(data.text || '');
        } catch (err) {
          reject(err);
        } finally {
          stream.getTracks().forEach((t) => t.stop());
        }
      };

      recorder.start();
      // Capture a 5 second snippet by default
      setTimeout(() => recorder.stop(), 5000);
    });
  } catch (err) {
    console.error('Transcription failed:', err);
    return '';
  }
}

