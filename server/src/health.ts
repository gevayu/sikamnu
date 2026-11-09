import { cfg } from './config.ts';
import { whisperReady } from './stt/whisper.ts';

/**
 * בדיקת ספקים: השרת שולח לכל ספק קריאה זולה בעלייה ופעם ביום, ושומר את התוצאה.
 * /health מחזיר אותה, והתוסף מתריע כבר כשנכנסים לשיחה, לפני שלוחצים "הקלט".
 */
export type ProviderId = 'deepgram' | 'assemblyai' | 'anthropic' | 'whisper';
export interface ProviderStatus {
  state: 'missing' | 'ok' | 'low' | 'error';
  detail?: string;           // HTTP status, יתרה, או הודעת שגיאה. לעולם לא המפתח עצמו
  checkedAt?: string;
}
export interface Issue { level: 'block' | 'warn'; text: string }

const LOW_CREDIT_USD = 2;
const DAY = 24 * 60 * 60 * 1000;

export const status: Record<ProviderId, ProviderStatus> = {
  deepgram: { state: 'missing' }, assemblyai: { state: 'missing' }, anthropic: { state: 'missing' }, whisper: { state: 'missing' },
};

async function call(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
}

const fail = async (r: Response): Promise<ProviderStatus> =>
  ({ state: 'error', detail: `HTTP ${r.status} ${(await r.text()).slice(0, 120)}` });

async function checkDeepgram(): Promise<ProviderStatus> {
  if (!cfg.deepgramKey) return { state: 'missing' };
  const headers = { Authorization: `Token ${cfg.deepgramKey}` };
  const r = await call('https://api.deepgram.com/v1/projects', { headers });
  if (!r.ok) return fail(r);
  const id = ((await r.json()) as any).projects?.[0]?.project_id;
  if (!id) return { state: 'ok', detail: 'no project' };
  // יתרה: מפתח תקין עם קרדיט שנגמר עדיין עונה 200 על projects
  const b = await call(`https://api.deepgram.com/v1/projects/${id}/balances`, { headers });
  if (!b.ok) return { state: 'ok', detail: `balance HTTP ${b.status}` };
  const amount = ((await b.json()) as any).balances?.reduce((s: number, x: any) => s + Number(x.amount ?? 0), 0) ?? 0;
  return { state: amount < LOW_CREDIT_USD ? 'low' : 'ok', detail: `$${amount.toFixed(2)}` };
}

async function checkAssembly(): Promise<ProviderStatus> {
  if (!cfg.assemblyKey) return { state: 'missing' };
  // ponytail: ל-AssemblyAI אין API ציבורי ליתרה. מפתח תקין עם קרדיט שנגמר יתגלה רק בתמלול. לבדוק אם נוסף endpoint.
  const r = await call('https://api.assemblyai.com/v2/transcript?limit=1', { headers: { Authorization: cfg.assemblyKey } });
  return r.ok ? { state: 'ok' } : fail(r);
}

async function checkAnthropic(): Promise<ProviderStatus> {
  if (!cfg.anthropicKey) return { state: 'missing' };
  // הודעה של טוקן אחד: בודקת מפתח, שם מודל וקרדיט יחד. עולה שבריר סנט ביום.
  const r = await call('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.summaryModel, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  });
  return r.ok ? { state: 'ok' } : fail(r);
}

async function checkWhisper(): Promise<ProviderStatus> {
  if (!cfg.whisperModel) return { state: 'missing' };
  return whisperReady() ? { state: 'ok', detail: 'local' } : { state: 'error', detail: `WHISPER_MODEL not found: ${cfg.whisperModel}` };
}

export async function checkProviders(): Promise<void> {
  const checks: [ProviderId, () => Promise<ProviderStatus>][] = [
    ['deepgram', checkDeepgram], ['assemblyai', checkAssembly], ['anthropic', checkAnthropic], ['whisper', checkWhisper],
  ];
  await Promise.all(checks.map(async ([id, fn]) => {
    const s = await fn().catch((e): ProviderStatus => ({ state: 'error', detail: e instanceof Error ? e.message : String(e) }));
    status[id] = { ...s, checkedAt: new Date().toISOString() };
  }));
  console.log(`[providers] ${new Date().toISOString()} ${Object.entries(status).map(([k, v]) => `${k}=${v.state}${v.detail ? `(${v.detail.slice(0, 40)})` : ''}`).join(' ')}`);
}

export function startProviderChecks() {
  checkProviders();
  setInterval(checkProviders, DAY).unref();
}

/** ספק תמלול שאפשר לשלוח אליו עבודה. low עדיין עובד, רק מתריעים. */
export const usable = (id: ProviderId) => status[id].state === 'ok' || status[id].state === 'low';

const NAMES: Record<ProviderId, string> = { deepgram: 'Deepgram', assemblyai: 'AssemblyAI', anthropic: 'Anthropic', whisper: 'whisper' };

/** תקלות בעברית לתוסף. block = ההקלטה לא תתומלל. warn = תעבוד, אבל משהו חסר או עומד להיגמר. */
export function issues(s: Record<Exclude<ProviderId, 'whisper'>, ProviderStatus> & { whisper?: ProviderStatus } = status): Issue[] {
  const out: Issue[] = [];
  const stt = ['deepgram', 'assemblyai'] as const;
  const ok = (id: (typeof stt)[number]) => s[id].state === 'ok' || s[id].state === 'low';
  const local = s.whisper?.state === 'ok';
  if (s.whisper?.state === 'error') out.push({ level: 'warn', text: `whisper מוגדר, אבל קובץ המודל לא נמצא. בדוק את WHISPER_MODEL בקובץ .env.` });
  if (!stt.some(ok) && local) {
    out.push({ level: 'warn', text: 'תמלול בסיום רץ מקומית ב-whisper. תמליל חי לא יעבוד בלי מפתח Deepgram או AssemblyAI.' });
  } else if (!stt.some(ok)) {
    out.push({ level: 'block', text: 'אין ספק תמלול תקין. בדוק את המפתחות של Deepgram ו-AssemblyAI בקובץ .env.' });
  } else {
    for (const id of stt) {
      if (s[id].state === 'error') out.push({ level: 'warn', text: `המפתח של ${NAMES[id]} נדחה (${s[id].detail?.slice(0, 60)}). השיחות יעברו לספק השני.` });
      if (s[id].state === 'missing') out.push({ level: 'warn', text: `אין מפתח ${NAMES[id]}. ${id === 'assemblyai' ? 'שיחות בעברית עם אנגלית יתומללו ב-Deepgram, ומונחים באנגלית ייפגעו.' : 'כל השיחות יתומללו ב-AssemblyAI.'}` });
      if (s[id].state === 'low') out.push({ level: 'warn', text: `נשארו ${s[id].detail} ביתרה של ${NAMES[id]}. כדאי להטעין.` });
    }
  }
  if (s.anthropic.state === 'missing') out.push({ level: 'warn', text: 'אין מפתח Anthropic. השיחה תתומלל, אבל בלי סיכום.' });
  if (s.anthropic.state === 'error') out.push({ level: 'warn', text: `המפתח של Anthropic נדחה (${s.anthropic.detail?.slice(0, 60)}). השיחה תתומלל, אבל בלי סיכום.` });
  return out;
}
