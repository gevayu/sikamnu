import { cfg } from '../config.ts';
import { status, type ProviderId } from '../health.ts';
import { assemblyai } from './assemblyai.ts';
import { deepgram } from './deepgram.ts';
import { mock } from './mock.ts';
import { whisper, whisperReady } from './whisper.ts';
import type { Lang, Mode, SttProvider } from './types.ts';

export const providers: Record<string, SttProvider> = { deepgram, assemblyai, whisper, mock };

/**
 * ברירת מחדל לפי (מצב, שפה). PRD סעיף 4.1:
 * עברית בלבד → Deepgram (זול, keyterms בעברית). מעורבת → AssemblyAI (code-switching).
 * ה-bake-off בשבוע 1 עשוי לשנות את זה. דריסה ב-env: STT_LIVE_PROVIDER / STT_BATCH_PROVIDER.
 * whisper (מקומי) הוא תמיד הגיבוי האחרון ב-batch, ו-STT_BATCH_PROVIDER=whisper הופך אותו לראשון.
 */
const DEFAULTS: Record<Mode, Record<Lang, string>> = {
  live: { he: 'deepgram', multi: 'assemblyai' },
  batch: { he: 'deepgram', multi: 'assemblyai' },
};

const hasKey = (id: string) =>
  id === 'deepgram' ? !!cfg.deepgramKey : id === 'assemblyai' ? !!cfg.assemblyKey : id === 'whisper' ? whisperReady() : id === 'mock';

/** ספק שאפשר לנסות: יש מפתח, ובדיקת הספקים לא מצאה אותו שבור. לפני הבדיקה הראשונה מניחים שהוא תקין. */
const usable = (id: string) => hasKey(id) && (id === 'mock' || status[id as ProviderId]?.state !== 'error');

const FALLBACK: Record<Mode, string[]> = { live: ['deepgram', 'assemblyai'], batch: ['deepgram', 'assemblyai', 'whisper'] };

/**
 * הספקים לפי סדר עדיפות למצב ולשפה: המועדף קודם, השני אחריו.
 * session.ts מנסה אותם לפי הסדר, כך שמפתח שבוטל לא מפיל שיחה.
 */
export function providerChain(mode: Mode, language: Lang): SttProvider[] {
  const forced = mode === 'live' ? cfg.liveProvider : cfg.batchProvider;
  const first = forced ?? DEFAULTS[mode][language];
  if (!providers[first]) throw new Error(`ספק STT לא מוכר: ${first}`);
  const order = [first, ...FALLBACK[mode].filter((x) => x !== first)];
  let chain = order.filter(usable).map((id) => providers[id]);
  if (!chain.length) {
    // mock רק כשאין שום מפתח (פיתוח). מפתחות שהבדיקה סימנה כשבורים עדיין נוסים: הבדיקה עלולה להיות ישנה,
    // ואם הם באמת שבורים session שומר את השיחה עם שגיאה. טקסט מזויף בשיחה אמיתית גרוע מכישלון גלוי.
    chain = order.filter(hasKey).map((id) => providers[id]);
    if (!chain.length) { console.warn('[stt] אין מפתחות STT, משתמש ב-mock'); return [mock]; }
  }
  if (chain[0].id !== first) console.warn(`[stt] ${first} לא זמין, משתמש ב-${chain[0].id}`);
  return chain;
}

export const pickProvider = (mode: Mode, language: Lang): SttProvider => providerChain(mode, language)[0];

/** עלות משוערת בדולרים, למד העלות הפנימי (PRD סעיף 12, שורה אחרונה) */
export const estimateCost = (p: SttProvider, mode: Mode, minutes: number): number =>
  Number((minutes * ((mode === 'live' ? p.pricing.livePerMin : p.pricing.batchPerMin) + p.pricing.diarizePerMin)).toFixed(4));
