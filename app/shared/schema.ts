import type { Profile } from './types';

export const PROFILES: Profile[] = [
  { id: 'interview', name: 'Interview', systemInstruction: 'Coach me concise answers, STAR method. Avoid buzzwords.' },
  { id: 'sales', name: 'Sales Call', systemInstruction: 'Be brief, propose value, suggest next step, avoid overtalking.' }
];
