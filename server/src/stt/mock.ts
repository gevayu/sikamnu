import { speakerLabel, type SttProvider } from './types.ts';

/** לפיתוח בלי מפתחות: segment מזויף כל 3 שניות אודיו. נבחר אוטומטית כשאין אף מפתח STT. */
export const mock: SttProvider = {
  id: 'mock',
  pricing: { livePerMin: 0, batchPerMin: 0, diarizePerMin: 0 },
  supports: { codeSwitch: true, liveDiarization: true },

  async startLive(opts, onSegment) {
    const bytesPerSec = opts.sampleRate * opts.channels * 2;
    let bytes = 0, next = 3, n = 0;
    return {
      send(pcm) {
        bytes += pcm.length;
        const t = bytes / bytesPerSec;
        if (t < next) return;
        const ch = (n++ % 2) as 0 | 1;
        onSegment({ key: `mock:${n}`, t0: next - 3, t1: t, channel: ch, speaker: speakerLabel(ch), text: `(mock) segment ${n} at ${t.toFixed(1)}s`, final: true });
        next += 3;
      },
      async close() {},
    };
  },

  async transcribeFile(wav, opts) {
    const secs = (wav.length - 44) / (opts.sampleRate * opts.channels * 2);
    const out = [];
    for (let t = 0, n = 0; t < secs; t += 5, n++) {
      const ch = (n % 2) as 0 | 1;
      out.push({ t0: t, t1: Math.min(t + 5, secs), channel: ch, speaker: speakerLabel(ch), text: `(mock) batch segment ${n + 1}`, final: true });
    }
    return out;
  },
};
