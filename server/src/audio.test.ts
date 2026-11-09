import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wavHeader, wavPcm, wrapWav } from './audio.ts';

test('wavPcm: WAV של 44 בייט מחזיר את ה-PCM כמו שהוא', () => {
  const pcm = Buffer.from([1, 2, 3, 4]);
  assert.deepEqual(wavPcm(wrapWav(pcm, 16000, 2)), pcm);
});

test('wavPcm: מדלג על chunk של LIST שמופיע לפני data (כמו ש-ffmpeg כותב)', () => {
  const pcm = Buffer.from([1, 2, 3, 4]);
  const h = wavHeader(pcm.length, 16000, 2);
  const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('INFO')]);
  const wav = Buffer.concat([h.subarray(0, 36), list, h.subarray(36), pcm]);
  assert.deepEqual(wavPcm(wav), pcm);
});
