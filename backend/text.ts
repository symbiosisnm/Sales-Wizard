import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function textHandler(req: Request, res: Response) {
  try {
    const { prompt, images } = req.body as { prompt: string; images?: string[] };
    const model = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: prompt }];
    if (images?.length) {
      for (const b64 of images) {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
      }
    }
    const gen = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }]
    });
    const text =
      gen.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') ?? '';
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message || e) });
  }
}
