import type { CallMeta, Msg } from '../shared.ts';

/**
 * זיהוי שיחה מהדום. הסלקטורים נשברים כשגוגל וזום משנים DOM, זה צפוי (PRD סיכון 2).
 * כל מה שתלוי ב-DOM חי בקובץ של הפלטפורמה, לא כאן.
 */
export interface Adapter {
  platform: CallMeta['platform'];
  inCall(): boolean;
  title(): string;
  participants(): string[];
  /** שם הדובר הפעיל עכשיו, או undefined אם אין אינדיקטור */
  activeSpeaker(): string | undefined;
}

export function run(a: Adapter) {
  let joined = false;
  let lastSpeaker: string | undefined;
  let tick = 0;
  const send = (msg: Msg) => chrome.runtime.sendMessage(msg).catch(() => {});
  const joinedMsg = (): Msg => ({ type: 'call:joined', meta: { platform: a.platform, title: a.title(), participants: a.participants() } });

  setInterval(() => {
    const now = a.inCall();
    if (now && !joined) {
      joined = true;
      send(joinedMsg());
    } else if (now && ++tick % 30 === 0) {
      send(joinedMsg());   // heartbeat: ה-service worker נרדם ומאבד state
    } else if (!now && joined) {
      joined = false;
      send({ type: 'call:left' });
    }
    if (!joined) return;
    const sp = a.activeSpeaker();
    if (sp && sp !== lastSpeaker) send({ type: 'call:speaker', name: sp });
    lastSpeaker = sp;
  }, 1000);
}

export const texts = (sel: string): string[] =>
  [...new Set([...document.querySelectorAll<HTMLElement>(sel)].map((e) => e.textContent?.trim() ?? '').filter(Boolean))];
