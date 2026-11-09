import { getSettings, keyterms, type Msg, type ServerEvent, type State } from './shared.ts';

/** מצב אחד לתוסף. שיחה אחת בכל רגע, PRD קהל MVP = אדם אחד. */
let state: State = { status: 'idle', mode: 'batch', language: 'multi' };

/**
 * כרום מכבה את ה-service worker אחרי כ-30 שניות בלי אירועים, וכל המשתנים נמחקים.
 * במצב batch אין תעבורה בזמן הקלטה, אז זה קורה באמצע שיחה. המצב נשמר ב-storage.session
 * (שורד כיבוי של ה-worker, נמחק בסגירת הדפדפן) וכל handler מחכה לשחזור לפני שהוא נוגע בו.
 */
const restored: Promise<void> = chrome.storage.session.get('state').then(async (r) => {
  if (r.state) state = r.state as State;
  // מצב ישן שאומר "מקליט" נבדק מול המסמך שבאמת מקליט, לכיוון אחד בלבד: לא מכריזים "הקלטה" שלא קיימת
  if ((state.status === 'recording' || state.status === 'armed') && !(await offscreenRecording())) state = { ...state, status: 'idle' };
  paint();
}).catch(() => {});

/** האם מסמך הלכידה מקליט עכשיו. זה מקור האמת, לא המשתנה state. */
async function offscreenRecording(): Promise<boolean> {
  if (!(await chrome.offscreen.hasDocument())) return false;
  const r = await chrome.runtime.sendMessage({ type: 'offscreen:status' } satisfies Msg).catch(() => null);
  return !!r?.recording;
}
let blink: ReturnType<typeof setInterval> | undefined;
let notifiedTab: number | undefined;
let notifiedKey = '';   // לא להציף בהתראות: מתריעים שוב רק כשתוצאת הבדיקה משתנה

const icon = (name: string) => chrome.action.setIcon({ path: `icons/${name}.png` }).catch(() => {});

/**
 * האייקון הוא מד המצב. אפור: אין שיחה. PAUSE כתום מהבהב: זוהתה שיחה, לחץ כדי להקליט.
 * PAUSE כהה: לכידה ל-buffer בלי הקלטה. אדום: מקליט. כחול: מתמלל ומסכם.
 * tabCapture לא מתחיל בלי לחיצה, לכן ההבהוב.
 */
function paint() {
  clearInterval(blink);
  blink = undefined;
  const s = state.status;
  if (s === 'idle' && state.meta) {
    // בדיקה בכניסה לשיחה מצאה שההקלטה לא תעבוד: אייקון אזהרה מהבהב במקום PAUSE
    const [on, off] = state.preflight?.block ? ['warn', 'warn-dim'] : ['pause', 'pause-dim'];
    let dim = false;
    icon(on);
    blink = setInterval(() => { icon(dim ? on : off); dim = !dim; }, 600);
    return;
  }
  icon(s === 'recording' ? 'rec' : s === 'armed' ? 'armed' : s === 'finishing' ? 'busy' : 'idle');
}

async function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  chrome.storage.session.set({ state }).catch(() => {});
  paint();
  chrome.runtime.sendMessage({ type: 'state:changed', state } satisfies Msg).catch(() => {});
}

chrome.runtime.onInstalled.addListener(async () => {
  // הפאנל נפתח מ-onClicked ולא אוטומטית, כי getMediaStreamId חייב לרוץ באותה הפעלה שנתנה activeTab
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  const s = await getSettings();
  setState({ mode: s.defaultMode, language: s.language });
});

/**
 * לחיצה על האייקון = הרגע היחיד שבו יש activeTab לטאב הזה. פותחים פאנל ולוכדים מיד.
 * PRD 5.1, מגבלה שנייה.
 */
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  (async () => {
    await restored;
    // לחיצה בזמן הקלטה לא מתחילה הקלטה חדשה. ב-0.1.4 זה קרה אחרי שה-worker שכח, וסגר שיחה אמיתית באמצע.
    if (await offscreenRecording()) {
      if (state.status !== 'recording' && state.status !== 'finishing') await setState({ status: 'recording', tabId: tab.id });
      return;
    }
    if (state.status === 'recording' || state.status === 'finishing') await setState({ status: 'idle' });   // המצב השמור שיקר: אין הקלטה בפועל
    if (state.status !== 'armed' || state.tabId !== tab.id) await arm(tab.id!, state.mode, state.language);
    if ((await getSettings()).autoRecord) await record();
  })().catch((e) => setState({ status: 'error', error: hebrewError(e) }));
});

function hebrewError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/TOKEN_BAD/.test(m)) return 'השרת רץ, אבל הטוקן בהגדרות התוסף לא תואם לשרת. פתח הגדרות, כתוב בשדה טוקן dev-token ושמור.';
  if (/WS_FAILED/.test(m)) return `השרת רץ והטוקן תקין, אבל חיבור ההקלטה לשרת נכשל. ${m.replace(/^.*WS_FAILED\s*/, '')}`;
  if (/SERVER_DOWN|אין חיבור לשרת/.test(m)) {
    const why = m.match(/\((.+)\)$/)?.[1];
    return `אין חיבור לשרת של Si-kam-nu. הוא עולה לבד בכניסה למחשב. אם הוא לא רץ, הפעל את start-server בתיקיית הפרויקט (.cmd ב-Windows, .sh במק) ולחץ שוב על האייקון.${why ? ` (${why})` : ''}`;
  }
  if (/not been invoked|activeTab/i.test(m)) return 'לחץ על אייקון Si-kam-nu בטאב של השיחה עצמה כדי להתחיל.';
  if (/Chrome pages cannot be captured/i.test(m)) return 'אפשר להקליט רק טאב של Meet או Zoom, לא עמוד של כרום.';
  if (/NotAllowedError|Permission denied|Permission dismissed/i.test(m)) return 'אין הרשאת מיקרופון. פתח הגדרות ולחץ "אפשר מיקרופון".';
  if (/NotFoundError|Requested device not found/i.test(m)) return 'לא נמצא מיקרופון. בדוק בהגדרות איזה מיקרופון נבחר.';
  return m;
}

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'לכידת אודיו של השיחה והמיקרופון לתמלול',
  });
}

const toOffscreen = (msg: Msg) => chrome.runtime.sendMessage(msg).catch(() => {});

/** בודק שהשרת חי לפני שתופסים את הטאב, אחרת הלכידה נתקעת פתוחה והמשתמש רואה שגיאה לא ברורה. */
async function assertServer(serverUrl: string, token: string): Promise<any> {
  let reason: string;
  try {
    const url = new URL('/health', serverUrl);
    url.searchParams.set('token', token);
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const j = await r.json();
      if (j.tokenOk === false) throw new Error('TOKEN_BAD');
      return j;
    }
    reason = `HTTP ${r.status}`;
  } catch (e) {
    if (e instanceof Error && e.message === 'TOKEN_BAD') throw e;
    reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  console.warn('[health]', serverUrl, reason);
  throw new Error(`SERVER_DOWN ${serverUrl} (${reason})`);
}

/** הבדיקה שרצה כשנכנסים לשיחה: שרת, טוקן, ומה שהשרת יודע על מפתחות הספקים. לא זורקת. */
async function preflight(): Promise<NonNullable<State['preflight']>> {
  const at = Date.now();
  const { serverUrl, token } = await getSettings();
  try {
    const j = await assertServer(serverUrl, token);
    const list: { level: string; text: string }[] = j.issues ?? [];
    return { block: list.find((i) => i.level === 'block')?.text, warnings: list.filter((i) => i.level === 'warn').map((i) => i.text), at };
  } catch (e) {
    return { block: hebrewError(e), warnings: [], at };
  }
}

async function arm(tabId: number, mode: State['mode'], language: State['language']) {
  const { serverUrl, token } = await getSettings();
  await assertServer(serverUrl, token);
  // לכידה קודמת שנשארה תפוסה (כישלון מיקרופון, שרת לא רץ, service worker שנרדם) חוסמת לכידה חדשה:
  // "Cannot capture a tab with an active stream". משחררים קודם.
  if (await chrome.offscreen.hasDocument()) await chrome.runtime.sendMessage({ type: 'offscreen:release' } satisfies Msg).catch(() => {});
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  // ה-streamId פג תוך שניות. ה-offscreen חייב לצרוך אותו מיד.
  const ok = await chrome.runtime.sendMessage({ type: 'offscreen:arm', streamId, settings: await getSettings() } satisfies Msg);
  if (ok !== true) throw new Error(typeof ok === 'string' ? ok : 'הלכידה נכשלה');
  await setState({ status: 'armed', tabId, mode, language, error: undefined, url: undefined });
}

async function record() {
  const settings = await getSettings();
  await toOffscreen({ type: 'offscreen:record', mode: state.mode, language: state.language, meta: state.meta, settings });
  await setState({ status: 'recording', startedAt: Date.now() });
}

function onServerEvent(ev: ServerEvent) {
  switch (ev.type) {
    case 'started': setState({ callId: ev.callId, provider: ev.provider }); break;
    case 'status': setState({ status: 'finishing' }); break;
    case 'done': setState({ status: 'done', url: ev.url }); chrome.notifications.create({ type: 'basic', iconUrl: 'icons/rec.png', title: 'Si-kam-nu', message: `השיחה מוכנה. ${Math.round(ev.durationSec / 60)} דקות.` }); break;
    case 'error': setState({ status: 'error', error: hebrewError(new Error(ev.message)) }); break;
    case 'closed': if (state.status === 'recording') setState({ status: 'error', error: 'החיבור לשרת נסגר באמצע ההקלטה. בדוק שחלון השרת עדיין פתוח.' }); break;
  }
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, reply) => {
  if (msg.type.startsWith('offscreen:') && msg.type !== 'offscreen:event') return;   // הודעות למסמך הלכידה, לא לכאן
  (async () => {
    await restored;
    switch (msg.type) {
      case 'call:joined': {
        // מגיע כל 30 שניות כ-heartbeat, כדי שה-service worker יחזור למצב הנכון אחרי שנרדם.
        // כל heartbeat גם מריץ בדיקה מחדש, כך ששרת שנפל באמצע היום מתגלה לפני ההקלטה ולא בה.
        const fresh = notifiedTab !== sender.tab?.id;
        await setState({ meta: msg.meta, tabId: sender.tab?.id, ...(state.status === 'done' || state.status === 'error' ? { status: 'idle' } : {}) });
        if (state.status !== 'idle') break;
        await setState({ preflight: await preflight() });
        const p = state.preflight!;
        const key = `${sender.tab?.id}|${p.block ?? ''}|${p.warnings.join('|')}`;
        if (fresh || key !== notifiedKey) {
          notifiedTab = sender.tab?.id;
          notifiedKey = key;
          const where = msg.meta.title || msg.meta.platform;
          chrome.notifications.create('joined', p.block
            ? { type: 'basic', iconUrl: 'icons/warn.png', title: 'זוהתה שיחה, אבל ההקלטה לא תעבוד', message: p.block }
            : { type: 'basic', iconUrl: 'icons/pause.png', title: 'זוהתה שיחה',
                message: `${where}. לחץ על אייקון ה-PAUSE המהבהב כדי להקליט.${p.warnings.length ? ` שים לב: ${p.warnings[0]}` : ''}` });
        }
        break;
      }
      case 'call:left':
        notifiedTab = undefined;
        if (state.status === 'recording') await toOffscreen({ type: 'offscreen:stop' });
        else await setState({ status: 'idle', meta: undefined });
        break;
      case 'call:speaker': if (state.status === 'recording') await toOffscreen({ type: 'offscreen:speaker', name: msg.name }); break;
      case 'ui:setMode': await setState({ mode: msg.mode, language: msg.language }); break;
      case 'ui:arm': {
        // ניסיון חוזר מהפאנל. יעבוד רק אם activeTab עדיין בתוקף לטאב הזה.
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await arm(state.tabId ?? tab?.id ?? 0, msg.mode, msg.language);
        break;
      }
      case 'ui:record': await record(); break;
      case 'ui:stop': await setState({ status: 'finishing' }); await toOffscreen({ type: 'offscreen:stop' }); break;
      case 'ui:mark': await toOffscreen({ type: 'offscreen:mark' }); break;
      case 'state:get': break;
      case 'offscreen:event': onServerEvent(msg.event); break;
    }
    reply(state);
  })().catch((e) => { setState({ status: 'error', error: hebrewError(e) }); reply(state); });
  return true;
});

chrome.commands.onCommand.addListener((cmd) => { if (cmd === 'mark-moment') toOffscreen({ type: 'offscreen:mark' }); });

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.tabId && state.status === 'recording') toOffscreen({ type: 'offscreen:stop' });
});
