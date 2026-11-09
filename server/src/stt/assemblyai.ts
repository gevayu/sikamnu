import WebSocket from 'ws';
import { cfg } from '../config.ts';
import { channelRms, downmix, splitChannels, wrapWav } from '../audio.ts';
import { speakerLabel, type Segment, type SttOpts, type SttProvider } from './types.ts';

const API = 'https://api.assemblyai.com';
const headers = () => ({ Authorization: cfg.assemblyKey, 'Content-Type': 'application/json' });

/** הסטרימינג של AssemblyAI מקבל מונו בלבד. שומרים ציר זמן של הערוץ החזק ומצביעים ברוב לכל turn. */
function dominant(loud: { t: number; ch: 0 | 1 }[], t0: number, t1: number): 0 | 1 {
  let me = 0, them = 0;
  for (const l of loud) {
    if (l.t < t0 - 0.2) continue;
    if (l.t > t1 + 0.2) break;
    if (l.ch === 0) me++; else them++;
  }
  return me > them ? 0 : 1;
}

async function upload(bytes: Buffer): Promise<string> {
  const r = await fetch(`${API}/v2/upload`, {
    method: 'POST',
    headers: { Authorization: cfg.assemblyKey, 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(bytes),
  });
  if (!r.ok) throw new Error(`assemblyai upload ${r.status}: ${await r.text()}`);
  return ((await r.json()) as any).upload_url;
}

async function transcribe(audio_url: string, opts: SttOpts, diarize: boolean): Promise<any[]> {
  const body: Record<string, unknown> = { audio_url, speaker_labels: diarize };
  if (opts.language === 'multi') body.language_detection = true; else body.language_code = 'he';
  if (opts.keyterms.length) body.keyterms_prompt = opts.keyterms;
  // ponytail: שם הפרמטר למודל (speech_model / speech_models) לאמת מול הדוקומנטציה ב-bake-off. ריק = ברירת המחדל של AssemblyAI.
  if (cfg.aaiSpeechModel) body.speech_model = cfg.aaiSpeechModel;
  let r = await fetch(`${API}/v2/transcript`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`assemblyai transcript ${r.status}: ${await r.text()}`);
  const { id } = (await r.json()) as any;
  for (;;) {
    await new Promise((res) => setTimeout(res, 3000));
    r = await fetch(`${API}/v2/transcript/${id}`, { headers: headers() });
    const j: any = await r.json();
    if (j.status === 'completed') return j.utterances ?? [];
    if (j.status === 'error') throw new Error(`assemblyai: ${j.error}`);
  }
}

export const assemblyai: SttProvider = {
  id: 'assemblyai',
  // ponytail: $0.15 לשעה לפי עמוד המחירים 2025. לאמת לפני ה-bake-off ולעדכן.
  pricing: { livePerMin: 0.0025, batchPerMin: 0.0025, diarizePerMin: 0 },
  supports: { codeSwitch: true, liveDiarization: false },

  async startLive(opts, onSegment) {
    const p = new URLSearchParams({ sample_rate: String(opts.sampleRate), encoding: 'pcm_s16le', format_turns: 'true' });
    if (cfg.aaiSpeechModel) p.set('speech_model', cfg.aaiSpeechModel);
    if (opts.keyterms.length) p.set('keyterms_prompt', JSON.stringify(opts.keyterms));
    const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${p}`, { headers: { Authorization: cfg.assemblyKey } });
    await new Promise<void>((res, rej) => { ws.once('open', res); ws.once('error', rej); });

    const loud: { t: number; ch: 0 | 1 }[] = [];
    let sent = 0;
    const bytesPerSec = opts.sampleRate * opts.channels * 2;

    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type !== 'Turn' || !m.transcript) return;
      const words: any[] = m.words ?? [];
      const t0 = (words[0]?.start ?? 0) / 1000;
      const t1 = (words.at(-1)?.end ?? 0) / 1000;
      const ch = dominant(loud, t0, t1);
      onSegment({
        key: `turn:${m.turn_order}`, t0, t1, channel: ch, speaker: speakerLabel(ch),
        text: m.transcript, final: !!m.end_of_turn,
        words: words.map((w) => ({ w: w.text, t0: w.start / 1000, t1: w.end / 1000 })),
      });
    });

    return {
      send: (pcm) => {
        const [me, them] = channelRms(pcm, opts.channels);
        loud.push({ t: sent / bytesPerSec, ch: them > me ? 1 : 0 });
        sent += pcm.length;
        if (ws.readyState === WebSocket.OPEN) ws.send(downmix(pcm, opts.channels));
      },
      close: () => new Promise<void>((res) => {
        const timer = setTimeout(() => { ws.terminate(); res(); }, 10_000);
        ws.once('close', () => { clearTimeout(timer); res(); });
        if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"Terminate"}'); else { clearTimeout(timer); res(); }
      }),
    };
  },

  async transcribeFile(wav, opts) {
    // שני קבצים מונו: ערוץ 0 (אני) בלי דיאריזציה, ערוץ 1 (הם) עם דיאריזציה. multichannel של AssemblyAI לא משלב speaker_labels.
    const pcm = wav.subarray(44);
    const [me, them] = splitChannels(pcm, opts.channels);
    const [uMe, uThem] = await Promise.all([
      upload(wrapWav(me, opts.sampleRate, 1)).then((u) => transcribe(u, opts, false)),
      upload(wrapWav(them, opts.sampleRate, 1)).then((u) => transcribe(u, opts, true)),
    ]);
    const labels = new Map<string, number>();
    const idx = (s: string) => { if (!labels.has(s)) labels.set(s, labels.size); return labels.get(s)!; };
    const toSeg = (u: any, ch: 0 | 1): Segment => ({
      t0: u.start / 1000, t1: u.end / 1000, channel: ch,
      speaker: ch === 0 ? speakerLabel(0) : speakerLabel(1, idx(String(u.speaker))),
      text: u.text, final: true,
      words: (u.words ?? []).map((w: any) => ({ w: w.text, t0: w.start / 1000, t1: w.end / 1000 })),
    });
    return [...uMe.map((u) => toSeg(u, 0)), ...uThem.map((u) => toSeg(u, 1))].sort((a, b) => a.t0 - b.t0);
  },
};
