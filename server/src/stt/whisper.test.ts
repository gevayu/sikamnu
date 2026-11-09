import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbfs, toSegments } from './whisper.ts';

const SR = 16000;
/** מונו PCM16: tone באמפליטודה amp בין from ל-to שניות, שקט בשאר */
function mono(secs: number, from: number, to: number, amp: number): Buffer {
  const b = Buffer.alloc(secs * SR * 2);
  for (let i = Math.floor(from * SR); i < Math.floor(to * SR); i++) b.writeInt16LE(Math.round(amp * Math.sin(i / 5)), i * 2);
  return b;
}

const json = (...segs: [number, number, string][]) =>
  ({ transcription: segs.map(([from, to, text]) => ({ offsets: { from, to }, text })) });

test('dbfs: שקט מוחלט הוא -Infinity, אמפליטודה מלאה קרוב ל-0', () => {
  assert.equal(dbfs(Buffer.alloc(3200), 0, 0.1, SR), -Infinity);
  assert.ok(dbfs(mono(1, 0, 1, 32767), 0, 1, SR) > -4);
});

test('toSegments: ממיר מילישניות לשניות, מסמן ערוץ ודובר, ומנקה רווחים', () => {
  const audio = mono(4, 0, 4, 8000);
  const out = toSegments(json([0, 1500, '  היי, מה שלומך? '], [2000, 3500, 'מצוין.']), 0, audio, SR);
  assert.deepEqual(out, [
    { t0: 0, t1: 1.5, channel: 0, speaker: 'אני', text: 'היי, מה שלומך?', final: true },
    { t0: 2, t1: 3.5, channel: 0, speaker: 'אני', text: 'מצוין.', final: true },
  ]);
});

test('toSegments: מוריד segment ריק ו-segment על שקט (הזיה של whisper כמו "תודה רבה")', () => {
  const audio = mono(4, 0, 1, 8000);   // דיבור רק בשנייה הראשונה
  const out = toSegments(json([0, 1000, 'שלום'], [1000, 1100, ''], [3000, 3300, 'תודה רבה.']), 1, audio, SR);
  assert.deepEqual(out.map((s) => s.text), ['שלום']);
  assert.equal(out[0].speaker, 'דובר 1');
});
