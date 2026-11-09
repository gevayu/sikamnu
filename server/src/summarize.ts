import Anthropic from '@anthropic-ai/sdk';
import { cfg } from './config.ts';
import type { Segment } from './stt/types.ts';

export interface ActionItem { item: string; owner?: string; due?: string; t?: number; done?: boolean }
export interface Summary {
  language: string;
  tldr: string;
  bullets: string[];
  decisions: string[];
  action_items: ActionItem[];
  open_questions: string[];
}

export interface SummaryMeta { title: string; participants: string[]; language: string }

// ponytail: תבנית אחת. תבניות לפי סוג שיחה (מכירה, kickoff, BNI) הן P1, מוסיפים כאן system לפי template.
const SYSTEM = `אתה מסכם שיחות עבודה של עצמאים ובעלי עסקים קטנים בישראל.
כללים:
- כותב בשפה שבה התנהלה השיחה. שיחה מעורבת עברית-אנגלית מסוכמת בעברית.
- מונחים, שמות מוצרים ומילים באנגלית נשארים באנגלית כמו שנאמרו. לא מתרגמים "onboarding" ל"קליטה".
- קצר וקונקרטי. כל בולט נושא עובדה, מספר, שם או החלטה. בלי "השיחה עסקה ב", בלי "חשוב לציין", בלי סיכום של הסיכום.
- action_items: רק דברים שמישהו התחייב לעשות. owner הוא שם מרשימת המשתתפים או "אני". due רק אם נאמר תאריך או מועד. t הוא הזמן בשניות שבו זה נאמר, מהסוגריים המרובעים בתמליל.
- open_questions: שאלות שעלו ולא נענו.
- אם התמליל ריק או לא מובן, החזר שדות ריקים. אל תמציא.
מחזיר JSON בלבד, בלי טקסט מסביב, במבנה:
{"language":"he|en","tldr":"משפט אחד","bullets":["..."],"decisions":["..."],"action_items":[{"item":"...","owner":"...","due":"...","t":123}],"open_questions":["..."]}`;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export async function summarize(segments: Segment[], meta: SummaryMeta): Promise<Summary | null> {
  if (!cfg.anthropicKey || !segments.length) return null;
  const client = new Anthropic({ apiKey: cfg.anthropicKey });
  const transcript = segments.map((s) => `[${Math.round(s.t0)}] (${fmt(s.t0)}) ${s.speaker}: ${s.text}`).join('\n');
  const msg = await client.messages.create({
    model: cfg.summaryModel,
    max_tokens: 2500,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `כותרת: ${meta.title || 'ללא'}\nמשתתפים: ${meta.participants.join(', ') || 'לא ידוע'}\nשפת השיחה: ${meta.language}\n\nתמליל:\n${transcript}`,
    }],
  });
  const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const s = JSON.parse(json) as Summary;
  return {
    language: s.language ?? 'he',
    tldr: s.tldr ?? '',
    bullets: s.bullets ?? [],
    decisions: s.decisions ?? [],
    action_items: (s.action_items ?? []).map((a) => ({ ...a, done: false })),
    open_questions: s.open_questions ?? [],
  };
}
