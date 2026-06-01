import { QUESTIONS } from '../data/questions.js';

export function isAnswered(qnum, answers, skipped) {
  const v = answers[qnum];
  const q = QUESTIONS[qnum];
  if (!q) return false;
  if (skipped[qnum]) return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'object' && v !== null) {
    if (q.type === 'likert') return q.rows.every((_, i) => v[i] != null && v[i] !== '');
    if (q.type === 'ranking') {
      const filled = Object.values(v).filter(Boolean).length;
      return filled >= (q.rankTop || q.items.length);
    }
    return Object.keys(v).length > 0;
  }
  return v != null;
}
