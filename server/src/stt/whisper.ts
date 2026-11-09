import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { splitChannels, wavPcm, wrapWav } from '../audio.ts';
import { cfg } from '../config.ts';
import { speakerLabel, type Segment, type SttProvider } from './types.ts';

/**
 * תמלול מקומי עם whisper.cpp (whisper-cli). batch בלבד: האודיו לא יוצא מהמחשב, ואין עלות.
 * כל ערוץ מתומלל בנפרד, כך ש"אני/הם" נשמר בלי דיאריזציה. בתוך ערוץ הטאב אין הפרדת דוברים.
 * מודל מומלץ לעברית: ivrit-ai/whisper-large-v3-turbo-ggml (ggml-ivrit-turbo.bin). WHISPER_MODEL = הנתיב אליו.
 */
const run = promisify(execFile);

/** segment שה-RMS שלו מתחת לסף נחשב שקט. whisper ממציא טקסט על שקט ("תודה רבה"), בעיקר בערוץ הטאב. */
const SILENCE_DBFS = -50;

export const whisperReady = () => !!cfg.whisperModel && existsSync(cfg.whisperModel);

/** עוצמה של מונו PCM16 בין t0 ל-t1 שניות, ב-dBFS */
export function dbfs(mono: Buffer, t0: number, t1: number, sampleRate: number): number {
  const a = Math.max(0, Math.floor(t0 * sampleRate)), b = Math.min(mono.length / 2, Math.ceil(t1 * sampleRate));
  let sum = 0;
  for (let i = a; i < b; i++) { const v = mono.readInt16LE(i * 2); sum += v * v; }
  const rms = b > a ? Math.sqrt(sum / (b - a)) : 0;
  return rms ? 20 * Math.log10(rms / 32768) : -Infinity;
}

/** פלט -oj של whisper-cli → segments של ערוץ אחד, בלי ריקים ובלי segments על שקט */
export function toSegments(json: any, channel: 0 | 1, mono: Buffer, sampleRate: number): Segment[] {
  return (json.transcription ?? [])
    .map((s: any): Segment => ({
      t0: s.offsets.from / 1000, t1: s.offsets.to / 1000, channel,
      speaker: speakerLabel(channel), text: String(s.text ?? '').trim(), final: true,
    }))
    .filter((s: Segment) => s.text && dbfs(mono, s.t0, s.t1, sampleRate) > SILENCE_DBFS);
}

export const whisper: SttProvider = {
  id: 'whisper',
  pricing: { livePerMin: 0, batchPerMin: 0, diarizePerMin: 0 },
  // ponytail: ivrit-turbo מתמלל עברית, ומונחים באנגלית יוצאים לפעמים בתעתיק. מצב multi לא נבדק עדיין, לבדוק ב-bake-off.
  supports: { codeSwitch: false, liveDiarization: false },

  async startLive() {
    // ponytail: whisper-stream קיים, אבל עוד לא נבדק בעברית. live נשאר בספקי הענן.
    throw new Error('whisper תומך רק בתמלול בסיום');
  },

  async transcribeFile(wav, opts) {
    if (opts.sampleRate !== 16000) throw new Error(`whisper צריך 16kHz, קיבל ${opts.sampleRate}`);
    const channels = splitChannels(wavPcm(wav), opts.channels);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sikamnu-whisper-'));
    const out: Segment[] = [];
    try {
      for (const [i, mono] of channels.slice(0, 2).entries()) {
        const ch = i as 0 | 1;
        if (dbfs(mono, 0, mono.length / 2 / opts.sampleRate, opts.sampleRate) <= SILENCE_DBFS - 10) continue;   // ערוץ שקט לגמרי
        const base = path.join(dir, `ch${ch}`);
        await fs.writeFile(`${base}.wav`, wrapWav(mono, opts.sampleRate, 1));
        const args = ['-m', cfg.whisperModel, '-l', 'he', '-f', `${base}.wav`, '-oj', '-of', base, '-np'];
        if (opts.keyterms.length) args.push('--prompt', opts.keyterms.join(', '));
        await run(cfg.whisperCli, args, { maxBuffer: 64 * 1024 * 1024 });
        out.push(...toSegments(JSON.parse(await fs.readFile(`${base}.json`, 'utf8')), ch, mono, opts.sampleRate));
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
    return out;
  },
};
