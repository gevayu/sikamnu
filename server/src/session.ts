import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs, type WriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type WebSocket from 'ws';
import { toOpus, wrapWav } from './audio.ts';
import { cfg } from './config.ts';
import { nameSpeakers, type SpeakerEvent } from './speakers.ts';
import { estimateCost, providerChain } from './stt/index.ts';
import type { Lang, LiveStream, Mode, Segment, SttOpts, SttProvider } from './stt/types.ts';
import { store, type CallRecord } from './store.ts';
import { summarize } from './summarize.ts';

export interface StartMsg {
  type: 'start';
  mode: Mode;
  language: Lang;
  sampleRate: number;
  channels: number;
  keyterms?: string[];
  meta?: { title?: string; platform?: string; participants?: string[] };
}

/**
 * שיחה אחת = חיבור WebSocket אחד.
 * בשני המצבים ה-PCM נכתב לקובץ. ב-live הוא גם זורם לספק ומחזיר segments תוך כדי.
 * ב-batch התמלול רץ על הקובץ הסגור בסיום, במודל pre-recorded (PRD 4.1).
 */
export class CallSession {
  readonly id = randomUUID();
  readonly startedAt = new Date();
  provider: SttProvider;
  private readonly chain: SttProvider[];
  private readonly opts: SttOpts;
  private readonly tmp: string;
  private readonly file: WriteStream;
  private bytes = 0;
  private live?: LiveStream;
  private segments: Segment[] = [];
  private markers: number[] = [];
  private speakerEvents: SpeakerEvent[] = [];
  private stopping = false;
  private readonly ws: WebSocket;
  private readonly start: StartMsg;

  private constructor(ws: WebSocket, start: StartMsg) {
    this.ws = ws;
    this.start = start;
    this.chain = providerChain(start.mode, start.language);
    this.provider = this.chain[0];
    this.opts = { language: start.language, sampleRate: start.sampleRate, channels: start.channels, keyterms: start.keyterms ?? [] };
    this.tmp = path.join(os.tmpdir(), `sikamnu-${this.id}.pcm`);
    this.file = createWriteStream(this.tmp);
  }

  static async create(ws: WebSocket, start: StartMsg): Promise<CallSession> {
    const s = new CallSession(ws, start);
    if (start.mode === 'live') {
      // ספק שנכשל בפתיחת הסטרים (מפתח בוטל, קרדיט נגמר) לא מפיל את השיחה: עוברים לבא בתור
      for (const p of s.chain) {
        try { s.live = await p.startLive(s.opts, (seg) => s.onSegment(seg)); s.provider = p; break; }
        catch (e) { console.error(`[stt] live ${p.id} נכשל:`, e instanceof Error ? e.message : e); }
      }
      if (!s.live) throw new Error('אף ספק תמלול לא הצליח לפתוח תמליל חי. נסה מצב "תמלול בסיום".');
    }
    s.send({ type: 'started', callId: s.id, provider: s.provider.id, mode: start.mode });
    return s;
  }

  /** שעון השיחה בשניות, לפי האודיו שהתקבל ולא לפי שעון הקיר */
  get t(): number { return this.bytes / (this.start.sampleRate * this.start.channels * 2); }

  private send(msg: unknown) { if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg)); }

  onAudio(buf: Buffer) {
    if (this.stopping) return;
    this.file.write(buf);
    this.bytes += buf.length;
    this.live?.send(buf);
  }

  private onSegment(seg: Segment) {
    if (seg.final) {
      const i = seg.key ? this.segments.findIndex((s) => s.key === seg.key) : -1;
      if (i >= 0) this.segments[i] = seg; else this.segments.push(seg);
    }
    this.send({ type: 'segment', ...seg });
  }

  mark() { this.markers.push(this.t); this.send({ type: 'marked', t: this.t }); }
  speaker(name: string) { if (name) this.speakerEvents.push({ t: this.t, name }); }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const { sampleRate, channels, mode, language } = this.start;
    const meta = this.start.meta ?? {};

    await this.live?.close();
    await new Promise<void>((res) => this.file.end(res));
    const wav = wrapWav(await fs.readFile(this.tmp), sampleRate, channels);
    const wavPath = this.tmp.replace(/\.pcm$/, '.wav');
    await fs.writeFile(wavPath, wav);

    // תמלול שנכשל אצל כל הספקים לא מוחק את השיחה: היא נשמרת עם האודיו ועם השגיאה, ואפשר לתמלל מחדש (recover.ts)
    let error: string | undefined;
    if (mode === 'batch') {
      this.send({ type: 'status', status: 'transcribing' });
      const failures: string[] = [];
      for (const p of this.chain) {
        try { this.segments = await p.transcribeFile(wav, this.opts); this.provider = p; error = undefined; break; }
        catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          console.error(`[stt] batch ${p.id} נכשל:`, m);
          failures.push(`${p.id}: ${m.slice(0, 120)}`);
          error = `התמלול נכשל. ${failures.join(' | ')}`;
        }
      }
    }
    this.segments = nameSpeakers(this.segments.sort((a, b) => a.t0 - b.t0), this.speakerEvents);

    this.send({ type: 'status', status: 'summarizing' });
    const summary = await summarize(this.segments, {
      title: meta.title ?? '', participants: meta.participants ?? [], language,
    }).catch((e) => { console.error('[summarize]', e); return null; });

    const oggPath = wavPath.replace(/\.wav$/, '.ogg');
    const opus = await toOpus(wavPath, oggPath);   // ponytail: בלי ffmpeg נשמר WAV, פי 15 מקום
    const audioPath = opus ? oggPath : wavPath;
    const audioMime = opus ? 'audio/ogg' : 'audio/wav';

    const durationSec = Math.round(this.t);
    const record: CallRecord = {
      id: this.id,
      title: meta.title || `שיחה ${this.startedAt.toLocaleDateString('he-IL')}`,
      platform: meta.platform ?? 'unknown',
      participants: meta.participants ?? [],
      startedAt: this.startedAt.toISOString(),
      durationSec,
      mode, language,
      provider: this.provider.id,
      segments: this.segments,
      markers: this.markers,
      summary,
      audioMime,
      audioExpiresAt: new Date(Date.now() + cfg.audioRetentionDays * 86_400_000).toISOString(),
      estCostUsd: error ? 0 : estimateCost(this.provider, mode, durationSec / 60),
      ...(error ? { error } : {}),
    };
    await store.saveCall(record);
    await store.saveAudio(this.id, audioPath, audioMime);
    await Promise.all([this.tmp, wavPath, oggPath].map((f) => fs.rm(f, { force: true })));

    this.send({ type: 'done', callId: this.id, url: `${cfg.publicUrl}/calls/${this.id}`, durationSec, estCostUsd: record.estCostUsd, ...(error ? { error } : {}) });
  }
}
