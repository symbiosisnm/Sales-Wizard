export async function getAnswer({ transcript = '', ocr = '', clipboard = '' } = {}) {
  const prompt = 'You are an AI assistant.\n' +
    'Transcript: ' + transcript + '\n' +
    'OCR: ' + ocr + '\n' +
    'Clipboard: ' + clipboard + '\n' +
    'Provide a concise helpful response.';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OpenAI API key');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }], max_tokens: 150, temperature: 0.7 })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('LLM API error: ' + res.status + ' ' + text);
  }
  const data = await res.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content.trim() : '');
}
