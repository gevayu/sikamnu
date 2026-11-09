import type { Segment } from './stt/types.ts';

export interface SpeakerEvent { t: number; name: string }

/**
 * שיוך שמות דוברים (PRD 5.2): קורלציה בין "מי מדבר עכשיו" מהדום לבין תוויות הדיאריזציה.
 * 1. לכל segment בערוץ "הם", השם הוא של אירוע הדום האחרון שהתחיל בין t0-1.5 ל-t1.
 * 2. לכל תווית דיאריזציה ("דובר 2") מצביעים ברוב על שם, ומשלימים segments בלי חפיפה ישירה.
 * נכשל בחפיפות, לכן ניתן לתיקון ידני בעמוד השיחה.
 */
export function nameSpeakers(segments: Segment[], events: SpeakerEvent[]): Segment[] {
  if (!events.length) return segments;
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const votes = new Map<string, Map<string, number>>();
  const direct = new Map<Segment, string>();

  for (const s of segments) {
    if (s.channel !== 1) continue;
    let name: string | undefined;
    for (const e of sorted) {
      if (e.t > s.t1) break;
      if (e.t >= s.t0 - 1.5) name = e.name;
    }
    if (!name) continue;
    direct.set(s, name);
    const v = votes.get(s.speaker) ?? new Map<string, number>();
    v.set(name, (v.get(name) ?? 0) + 1);
    votes.set(s.speaker, v);
  }

  const winner = new Map<string, string>();
  for (const [label, v] of votes) winner.set(label, [...v.entries()].sort((a, b) => b[1] - a[1])[0][0]);

  return segments.map((s) => {
    if (s.channel !== 1) return s;
    const name = direct.get(s) ?? winner.get(s.speaker);
    return name ? { ...s, speaker: name } : s;
  });
}
