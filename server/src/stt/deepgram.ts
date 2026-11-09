import WebSocket from 'ws';
import { cfg } from '../config.ts';
import { speakerLabel, type Segment, type SttOpts, type SttProvider } from './types.ts';

const HOST = 'api.deepgram.com/v1/listen';

function query(opts: SttOpts, live: boolean): URLSearchParams {
  // ponytail: language=multi של Nova-3 לא כולל עברית (PRD סעיף 4), לכן תמיד he.
  // כש-Deepgram יוסיפו עברית ל-multi, להחליף כאן ל-opts.language === 'multi' ? 'multi' : 'he' ולעדכן supports.codeSwitch.
  const p = new URLSearchParams({
    model: 'nova-3', language: 'he', multichannel: 'true', diarize: 'true', smart_format: 'true', punctuate: 'true',
  });
  if (live) {
    p.set('encoding', 'linear16');
    p.set('sample_rate', String(opts.sampleRate));
    p.set('channels', String(opts.channels));
    p.set('interim_results', 'true');
    p.set('endpointing', '300');
  } else {
    p.set('utterances', 'true');
  }
  for (const k of opts.keyterms) p.append('keyterm', k);
  return p;
}

const words = (ws: any[] | undefined) => (ws ?? []).map((w) => ({ w: w.punctuated_word ?? w.word, t0: w.start, t1: w.end }));

export const deepgram: SttProvider = {
  id: 'deepgram',
  // מחירון ספטמבר 2026, PRD סעיף 4. live רגיל (לא מבצע).
  pricing: { livePerMin: 0.0077, batchPerMin: 0.0043, diarizePerMin: 0.002 },
  supports: { codeSwitch: false, liveDiarization: true },

  async startLive(opts, onSegment) {
    const ws = new WebSocket(`wss://${HOST}?${query(opts, true)}`, {
      headers: { Authorization: `Token ${cfg.deepgramKey}` },
    });
    await new Promise<void>((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    // Deepgram סוגר אחרי 10 שניות בלי אודיו
    const keepAlive = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"KeepAlive"}'); }, 5000);

    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type !== 'Results') return;
      const alt = m.channel?.alternatives?.[0];
      if (!alt?.transcript) return;
      const ch = (m.channel_index?.[0] ?? 0) as 0 | 1;
      const seg: Segment = {
        key: `${ch}:${m.start}`,
        t0: m.start, t1: m.start + m.duration, channel: ch,
        speaker: speakerLabel(ch, alt.words?.[0]?.speaker),
        text: alt.transcript, final: !!m.is_final, words: words(alt.words),
      };
      onSegment(seg);
    });

    return {
      send: (pcm) => { if (ws.readyState === WebSocket.OPEN) ws.send(pcm); },
      close: () => new Promise<void>((res) => {
        clearInterval(keepAlive);
        const timer = setTimeout(() => { ws.terminate(); res(); }, 10_000);
        ws.once('close', () => { clearTimeout(timer); res(); });
        if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"CloseStream"}'); else { clearTimeout(timer); res(); }
      }),
    };
  },

  async transcribeFile(wav, opts) {
    const r = await fetch(`https://${HOST}?${query(opts, false)}`, {
      method: 'POST',
      headers: { Authorization: `Token ${cfg.deepgramKey}`, 'Content-Type': 'audio/wav' },
      body: new Uint8Array(wav),
    });
    if (!r.ok) throw new Error(`deepgram ${r.status}: ${await r.text()}`);
    const j: any = await r.json();
    const utterances: any[] = j.results?.utterances ?? [];
    return utterances.map((u) => ({
      t0: u.start, t1: u.end, channel: (u.channel ?? 0) as 0 | 1,
      speaker: speakerLabel(u.channel ?? 0, u.speaker),
      text: u.transcript, final: true, words: words(u.words),
    }));
  },
};
