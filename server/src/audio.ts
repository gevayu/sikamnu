import { spawn } from 'node:child_process';

export function wavHeader(dataBytes: number, sampleRate: number, channels: number): Buffer {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataBytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22); b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * channels * 2, 28); b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(dataBytes, 40);
  return b;
}

export const wrapWav = (pcm: Buffer, sampleRate: number, channels: number): Buffer =>
  Buffer.concat([wavHeader(pcm.length, sampleRate, channels), pcm]);

/** PCM16 interleaved → מערך של ערוצים מונו */
export function splitChannels(pcm: Buffer, channels: number): Buffer[] {
  const frames = Math.floor(pcm.length / (2 * channels));
  const out = Array.from({ length: channels }, () => Buffer.alloc(frames * 2));
  for (let f = 0; f < frames; f++)
    for (let c = 0; c < channels; c++)
      out[c].writeInt16LE(pcm.readInt16LE((f * channels + c) * 2), f * 2);
  return out;
}

/** ממוצע הערוצים, למי שמקבל רק מונו */
export function downmix(pcm: Buffer, channels: number): Buffer {
  if (channels === 1) return pcm;
  const frames = Math.floor(pcm.length / (2 * channels));
  const out = Buffer.alloc(frames * 2);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += pcm.readInt16LE((f * channels + c) * 2);
    out.writeInt16LE(Math.round(sum / channels), f * 2);
  }
  return out;
}

/** RMS לכל ערוץ, לשיוך "מי דיבר" כשהספק לא תומך ב-multichannel */
export function channelRms(pcm: Buffer, channels: number): number[] {
  const frames = Math.floor(pcm.length / (2 * channels));
  const acc = new Array<number>(channels).fill(0);
  for (let f = 0; f < frames; f++)
    for (let c = 0; c < channels; c++) {
      const v = pcm.readInt16LE((f * channels + c) * 2);
      acc[c] += v * v;
    }
  return acc.map((s) => (frames ? Math.sqrt(s / frames) : 0));
}

/** WAV → Opus ב-ffmpeg. false אם ffmpeg לא מותקן או נכשל. */
export function toOpus(wavPath: string, outPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-c:a', 'libopus', '-b:a', '32k', outPath]);
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
}
