import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameSpeakers } from './speakers.ts';
import type { Segment } from './stt/types.ts';

const seg = (t0: number, t1: number, channel: 0 | 1, speaker: string): Segment =>
  ({ t0, t1, channel, speaker, text: 'x', final: true });

test('שם מהדום מוחלף על תווית דיאריזציה, ומשלים segments בלי חפיפה', () => {
  const segments = [
    seg(0, 3, 0, 'אני'),
    seg(3, 6, 1, 'דובר 1'),
    seg(6, 9, 1, 'דובר 2'),
    seg(20, 23, 1, 'דובר 1'),   // אין אירוע דום, מקבל מהרוב
  ];
  const events = [{ t: 3.2, name: 'דני' }, { t: 6.5, name: 'רותם' }];
  const out = nameSpeakers(segments, events);
  assert.deepEqual(out.map((s) => s.speaker), ['אני', 'דני', 'רותם', 'דני']);
});

test('בלי אירועים לא נוגעים בכלום', () => {
  const s = [seg(0, 1, 1, 'דובר 1')];
  assert.deepEqual(nameSpeakers(s, []), s);
});
