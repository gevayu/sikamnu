/** live = סטרימינג, מודל streaming. batch = תמלול הקובץ הסגור בסיום, מודל pre-recorded. */
export type Mode = 'live' | 'batch';
/** he = עברית בלבד. multi = עברית עם אנגלית באותה שיחה. */
export type Lang = 'he' | 'multi';

export interface Word { w: string; t0: number; t1: number }

export interface Segment {
  key?: string;        // מזהה יציב של אותו utterance בין interim ל-final (סטרימינג בלבד)
  t0: number;          // שניות מתחילת ההקלטה
  t1: number;
  channel: 0 | 1;      // 0 = מיקרופון (אני), 1 = טאב (הם)
  speaker: string;     // "אני", "דובר 2", או שם אחרי קורלציה עם הדום
  text: string;
  final: boolean;      // false = interim בסטרימינג, יוחלף
  words?: Word[];
}

export interface SttOpts {
  language: Lang;
  sampleRate: number;
  channels: number;
  keyterms: string[];
}

export interface LiveStream {
  /** PCM16LE interleaved, לפי channels ב-opts */
  send(pcm: Buffer): void;
  /** סוגר וממתין ל-segments האחרונים */
  close(): Promise<void>;
}

export interface Pricing {
  livePerMin: number;
  batchPerMin: number;
  diarizePerMin: number;
}

export interface SttProvider {
  id: string;
  pricing: Pricing;
  supports: { codeSwitch: boolean; liveDiarization: boolean };
  startLive(opts: SttOpts, onSegment: (s: Segment) => void): Promise<LiveStream>;
  transcribeFile(wav: Buffer, opts: SttOpts): Promise<Segment[]>;
}

export const speakerLabel = (channel: number, diarized?: number | null): string =>
  channel === 0 ? 'אני' : `דובר ${diarized == null ? 1 : diarized + 1}`;
