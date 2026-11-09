import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issues, type ProviderStatus } from './health.ts';

const st = (d: ProviderStatus['state'], a: ProviderStatus['state'], c: ProviderStatus['state']) =>
  ({ deepgram: { state: d }, assemblyai: { state: a }, anthropic: { state: c } });

test('הכל תקין: אין תקלות', () => {
  assert.deepEqual(issues(st('ok', 'ok', 'ok')), []);
});

test('שני ספקי התמלול לא זמינים: חוסם, ולא מוסיף אזהרות כפולות עליהם', () => {
  const out = issues(st('error', 'missing', 'ok'));
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'block');
});

test('ספק אחד נדחה ויתרה נמוכה בשני: אזהרות בלבד', () => {
  const out = issues({ deepgram: { state: 'low', detail: '$1.20' }, assemblyai: { state: 'error', detail: 'HTTP 401' }, anthropic: { state: 'ok' } });
  assert.deepEqual(out.map((i) => i.level), ['warn', 'warn']);
  assert.ok(out.some((i) => i.text.includes('$1.20')));
});

test('רק whisper מקומי: לא חוסם, ואזהרה אחת שאין תמליל חי', () => {
  const out = issues({ ...st('missing', 'missing', 'ok'), whisper: { state: 'ok' } });
  assert.deepEqual(out.map((i) => i.level), ['warn']);
  assert.match(out[0].text, /תמליל חי/);
});

test('בלי Anthropic: אזהרה שאין סיכום', () => {
  const out = issues(st('ok', 'ok', 'missing'));
  assert.equal(out.length, 1);
  assert.match(out[0].text, /בלי סיכום/);
});
