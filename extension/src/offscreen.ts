import { keyterms, type Msg, type ServerEvent } from './shared.ts';

/**
 * לכידת אודיו. ערוץ 0 = מיקרופון (אני), ערוץ 1 = טאב (הם). PCM16LE 16kHz.
 * "הפעל" מתחיל לכידה ל-ring buffer של 3 דקות. "הקלט" פותח WebSocket, שופך את ה-buffer וממשיך לזרום.
 * ה-buffer הרטרואקטיבי הוא PRD סעיף 6, P0.
 */
const SAMPLE_RATE = 16_000;
const CHANNELS = 2;
const RING_BYTES = 3 * 60 * SAMPLE_RATE * CHANNELS * 2; // 3 דקות, 11.5MB

let ctx: AudioContext | undefined;
let tracks: MediaStreamTrack[] = [];
let ws: WebSocket | undefined;
let ring: ArrayBuffer[] = [];
let ringBytes = 0;
let recording = false;

const emit = (event: ServerEvent) => chrome.runtime.sendMessage({ type: 'offscreen:event', event } satisfies Msg).catch(() => {});

function pushRing(chunk: ArrayBuffer) {
  ring.push(chunk);
  ringBytes += chunk.byteLength;
  while (ringBytes > RING_BYTES) ringBytes -= ring.shift()!.byteLength;
}

async function arm(streamId: string, micDeviceId: string) {
  await release();
  try { await capture(streamId, micDeviceId); }
  catch (e) { await release(); throw e; }   // אחרת סטרים הטאב נשאר תפוס והלחיצה הבאה נכשלת
}

async function capture(streamId: string, micDeviceId: string) {
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as MediaTrackConstraints,
    video: false,
  });
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: micDeviceId ? { deviceId: { exact: micDeviceId }, echoCancellation: true } : { echoCancellation: true },
  });
  tracks = [...tab.getAudioTracks(), ...mic.getAudioTracks()];

  ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await ctx.audioWorklet.addModule('pcm-worklet.js');
  const tabSrc = ctx.createMediaStreamSource(tab);
  const micSrc = ctx.createMediaStreamSource(mic);
  const merger = ctx.createChannelMerger(2);
  micSrc.connect(merger, 0, 0);
  tabSrc.connect(merger, 0, 1);
  const worklet = new AudioWorkletNode(ctx, 'pcm-worklet', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete' });
  merger.connect(worklet);
  // לכידת טאב משתיקה אותו למשתמש. מחזירים את האודיו לרמקולים.
  tabSrc.connect(ctx.destination);

  worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (recording && ws?.readyState === WebSocket.OPEN) ws.send(e.data);
    else pushRing(e.data);
  };
}

const CONNECT_ATTEMPTS = 5;
let attempt = 0;   // מתאפס ב-release, כדי שניסיון חוזר ישן לא יפתח חיבור אחרי עצירה

/**
 * פותח את ה-WS לשרת. אם החיבור נכשל לפני שנפתח (השרת עולה מחדש ב---watch, נמשך שנייה),
 * מנסה שוב עד 5 פעמים. בינתיים האודיו ממשיך להיכנס ל-ring buffer ולא הולך לאיבוד.
 */
function record(msg: Extract<Msg, { type: 'offscreen:record' }>, n = 1) {
  attempt = n;
  const url = new URL('/ws', msg.settings.serverUrl.replace(/^http/, 'ws'));
  url.searchParams.set('token', msg.settings.token);
  const sock = new WebSocket(url);
  ws = sock;
  sock.binaryType = 'arraybuffer';
  let opened = false;
  sock.onopen = () => {
    opened = true;
    sock.send(JSON.stringify({
      type: 'start', mode: msg.mode, language: msg.language, sampleRate: SAMPLE_RATE, channels: CHANNELS,
      keyterms: keyterms(msg.settings), meta: msg.meta,
    }));
    for (const chunk of ring) sock.send(chunk);
    ring = []; ringBytes = 0;
    recording = true;
  };
  sock.onmessage = (e) => emit(JSON.parse(e.data));
  sock.onclose = (e) => {
    recording = false;
    if (opened) return emit({ type: 'closed' });
    if (attempt !== n || !ctx) return;   // בוטל בינתיים
    if (n < CONNECT_ATTEMPTS) { setTimeout(() => { if (attempt === n && ctx) record(msg, n + 1); }, 1500); return; }
    // הדפדפן לא מגלה למה WebSocket נכשל (תמיד 1006). בודקים מאותו מסמך אם השרת עונה, כדי להבחין בין "אין שרת" ל"החיבור עצמו נחסם".
    probe(msg.settings.serverUrl, msg.settings.token).then((p) =>
      emit({ type: 'error', message: `WS_FAILED (WebSocket ${e.code}, ${CONNECT_ATTEMPTS} ניסיונות. בדיקת שרת מהמסמך: ${p})` }));
  };
}

async function probe(serverUrl: string, token: string): Promise<string> {
  try {
    const url = new URL('/health', serverUrl);
    url.searchParams.set('token', token);
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    const j = r.ok ? await r.json() : null;
    return `HTTP ${r.status}${j ? `, tokenOk=${j.tokenOk}` : ''}`;
  } catch (e) {
    return `נכשלה: ${e instanceof Error ? `${e.name}: ${e.message}` : e}`;
  }
}

function stop() {
  recording = false;
  ws?.send(JSON.stringify({ type: 'stop' }));   // השרת סוגר אחרי done
  teardown();
}

/** משחרר הכל, כולל WS פתוח. לפני לכידה חדשה. */
async function release() {
  recording = false;
  attempt = 0;
  if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
  ws = undefined;
  await teardown();
}

async function teardown() {
  tracks.forEach((t) => t.stop());
  tracks = [];
  await ctx?.close().catch(() => {});
  ctx = undefined;
  ring = []; ringBytes = 0;
}

chrome.runtime.onMessage.addListener((msg: Msg, _sender, reply) => {
  // מקור האמת להקלטה: ה-background נכבה ע"י כרום ושוכח, המסמך הזה ממשיך להקליט
  if (msg.type === 'offscreen:status') { reply({ recording: recording || (!!ws && ws.readyState === WebSocket.OPEN) }); return; }
  (async () => {
    switch (msg.type) {
      case 'offscreen:arm': await arm(msg.streamId, msg.settings.micDeviceId); break;
      case 'offscreen:record': record(msg); break;
      case 'offscreen:stop': stop(); break;
      case 'offscreen:release': await release(); break;
      case 'offscreen:mark': ws?.send(JSON.stringify({ type: 'marker' })); break;
      case 'offscreen:speaker': ws?.send(JSON.stringify({ type: 'speaker', name: msg.name })); break;
      default: return;
    }
    reply(true);
  })().catch((e) => {
    // שם השגיאה (NotAllowedError) חשוב יותר מהטקסט, ה-background מתרגם לפי זה
    const text = e instanceof DOMException ? `${e.name}: ${e.message}` : (e?.message ?? String(e));
    reply(text);
    emit({ type: 'error', message: text });
  });
  return true;
});
