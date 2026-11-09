import { send, type Lang, type Mode, type Msg, type Segment, type State } from './shared.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status'), transcript = $('transcript');
const btn = { record: $<HTMLButtonElement>('record'), stop: $<HTMLButtonElement>('stop'), mark: $<HTMLButtonElement>('mark') };
const radios = (name: string) => [...document.querySelectorAll<HTMLInputElement>(`input[name=${name}]`)];
const picked = (name: string) => radios(name).find((r) => r.checked)?.value;

let state: State = { status: 'idle', mode: 'batch', language: 'multi' };
let timer: number | undefined;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function render() {
  const s = state.status;
  radios('mode').forEach((r) => { r.checked = r.value === state.mode; r.disabled = s === 'recording' || s === 'finishing'; });
  radios('lang').forEach((r) => { r.checked = r.value === state.language; r.disabled = s === 'recording' || s === 'finishing'; });
  btn.record.disabled = s !== 'armed';
  btn.stop.disabled = s !== 'recording';
  btn.mark.disabled = s !== 'recording';

  status.className = s;
  const title = state.meta?.title || (state.meta ? state.meta.platform : '');
  const modeTxt = state.mode === 'live' ? 'תמליל חי' : 'תמלול בסיום';
  switch (s) {
    case 'idle': {
      const p = state.preflight;
      if (state.meta && p?.block) { status.className = 'error'; status.textContent = `ההקלטה לא תעבוד: ${p.block}`; break; }
      status.textContent = state.meta ? `שיחה: ${title}. לחץ על אייקון ה-PAUSE המהבהב בטאב של השיחה כדי להקליט.` : 'אין שיחה פעילה. פתח Google Meet או Zoom בדפדפן. כשהשיחה תזוהה האייקון יהפוך ל-PAUSE מהבהב.';
      if (state.meta && p?.warnings.length) status.textContent += ` שים לב: ${p.warnings.join(' ')}`;
      break;
    }
    case 'armed': status.textContent = `מוכן. ${modeTxt}. שומר את 3 הדקות האחרונות בזיכרון, לחץ "הקלט" כשתרצה.`; break;
    case 'recording': status.innerHTML = `מקליט <span id="timer">0:00</span> · ${modeTxt}${state.provider ? ` · ${state.provider}` : ''}`; break;
    case 'finishing': status.textContent = state.mode === 'batch' ? 'מתמלל את ההקלטה ומסכם. דקה עד שלוש.' : 'מסכם.'; break;
    case 'done': status.innerHTML = `מוכן. <a href="${state.url}" target="_blank">פתח את עמוד השיחה</a>`; break;
    case 'error': status.textContent = `שגיאה: ${state.error}`; break;
  }

  clearInterval(timer);
  if (s === 'recording' && state.startedAt) {
    const tick = () => { const el = document.getElementById('timer'); if (el) el.textContent = mmss((Date.now() - state.startedAt!) / 1000); };
    tick(); timer = window.setInterval(tick, 1000);
  }
  if (s === 'recording' && state.mode === 'batch' && !transcript.childElementCount) transcript.innerHTML = '<p class="muted">במצב "בסיום" אין תמליל חי. הכל מגיע בעמוד השיחה.</p>';
  if (s === 'armed') transcript.innerHTML = '';
}

function addSegment(seg: Segment) {
  const key = seg.key ?? `${seg.channel}:${seg.t0}`;
  let el = transcript.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
  if (!el) {
    el = document.createElement('div');
    el.dataset.key = key;
    transcript.append(el);
  }
  el.className = `seg ${seg.channel === 0 ? 'me' : ''} ${seg.final ? '' : 'interim'}`;
  el.innerHTML = `<span class="who">${mmss(seg.t0)} ${seg.speaker}</span><span class="txt"></span>`;
  el.querySelector('.txt')!.textContent = seg.text;
  transcript.scrollTop = transcript.scrollHeight;
}

chrome.runtime.onMessage.addListener((msg: Msg) => {
  if (msg.type === 'state:changed') { state = msg.state; render(); }
  if (msg.type === 'offscreen:event' && msg.event.type === 'segment') addSegment(msg.event);
});

const modeChange = () => send<State>({ type: 'ui:setMode', mode: picked('mode') as Mode, language: picked('lang') as Lang }).then((s) => { state = s; render(); });
radios('mode').forEach((r) => r.addEventListener('change', modeChange));
radios('lang').forEach((r) => r.addEventListener('change', modeChange));

btn.record.onclick = () => send<State>({ type: 'ui:record' }).then((s) => { state = s; render(); });
btn.stop.onclick = () => send<State>({ type: 'ui:stop' }).then((s) => { state = s; render(); });
btn.mark.onclick = () => send({ type: 'ui:mark' });
$('options').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
$('ver').textContent = 'v' + chrome.runtime.getManifest().version;   // לראות מיד אם כרום רוענן אחרי build

send<State>({ type: 'state:get' }).then((s) => { state = s; render(); });
