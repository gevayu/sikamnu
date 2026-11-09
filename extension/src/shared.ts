export type Mode = 'live' | 'batch';
export type Lang = 'he' | 'multi';
export type Status = 'idle' | 'armed' | 'recording' | 'finishing' | 'done' | 'error';

export interface Settings {
  serverUrl: string;
  token: string;
  defaultMode: Mode;
  language: Lang;
  glossary: string;       // מונח בכל שורה, נשלח כ-keyterms
  micDeviceId: string;
  autoRecord: boolean;    // לחיצה על האייקון מתחילה להקליט מיד, בלי "הקלט"
}

export const DEFAULTS: Settings = {
  serverUrl: 'http://localhost:8787',
  token: 'dev-token',
  defaultMode: 'batch',
  language: 'multi',
  glossary: '',
  micDeviceId: '',
  autoRecord: true,
};

export const getSettings = async (): Promise<Settings> =>
  ({ ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) }) as Settings;

export const keyterms = (s: Settings) => s.glossary.split('\n').map((x) => x.trim()).filter(Boolean);

export interface CallMeta { platform: 'meet' | 'zoom'; title: string; participants: string[] }

export interface State {
  status: Status;
  tabId?: number;
  meta?: CallMeta;
  mode: Mode;
  language: Lang;
  callId?: string;
  provider?: string;
  url?: string;
  error?: string;
  startedAt?: number;
  /** תוצאת הבדיקה שרצה כשנכנסים לשיחה. block = ההקלטה לא תעבוד. warnings = תעבוד, עם חוסר. */
  preflight?: { block?: string; warnings: string[]; at: number };
}

export interface Segment {
  key?: string; t0: number; t1: number; channel: 0 | 1; speaker: string; text: string; final: boolean;
}

/** הודעות בין חלקי התוסף. content → background → offscreen / sidepanel. */
export type Msg =
  | { type: 'call:joined'; meta: CallMeta }
  | { type: 'call:left' }
  | { type: 'call:speaker'; name: string }
  | { type: 'ui:arm'; mode: Mode; language: Lang }
  | { type: 'ui:record' }
  | { type: 'ui:stop' }
  | { type: 'ui:mark' }
  | { type: 'ui:setMode'; mode: Mode; language: Lang }
  | { type: 'state:get' }
  | { type: 'state:changed'; state: State }
  | { type: 'offscreen:arm'; streamId: string; settings: Settings }
  | { type: 'offscreen:record'; mode: Mode; language: Lang; meta?: CallMeta; settings: Settings }
  | { type: 'offscreen:stop' }
  | { type: 'offscreen:release' }
  | { type: 'offscreen:status' }
  | { type: 'offscreen:mark' }
  | { type: 'offscreen:speaker'; name: string }
  | { type: 'offscreen:event'; event: ServerEvent }
  | { type: 'offscreen:level'; me: number; them: number };

export type ServerEvent =
  | { type: 'started'; callId: string; provider: string; mode: Mode }
  | ({ type: 'segment' } & Segment)
  | { type: 'marked'; t: number }
  | { type: 'status'; status: string }
  | { type: 'done'; callId: string; url: string; durationSec: number; estCostUsd: number }
  | { type: 'error'; message: string }
  | { type: 'closed' };

export const send = <T = unknown>(msg: Msg): Promise<T> => chrome.runtime.sendMessage(msg);
