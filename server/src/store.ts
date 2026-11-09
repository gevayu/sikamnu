import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cfg } from './config.ts';
import type { Lang, Mode, Segment } from './stt/types.ts';
import type { Summary } from './summarize.ts';

export interface CallRecord {
  id: string;
  title: string;
  platform: string;
  participants: string[];
  startedAt: string;
  durationSec: number;
  mode: Mode;
  language: Lang;
  provider: string;
  segments: Segment[];
  markers: number[];
  summary: Summary | null;
  audioMime: string | null;
  audioExpiresAt: string | null;
  estCostUsd: number;
  /** תמלול שנכשל אצל כל הספקים. השיחה והאודיו נשמרים בכל זאת. */
  error?: string;
}

export type AudioRef = { path: string; mime: string } | { url: string; mime: string };

export interface Store {
  saveCall(c: CallRecord): Promise<void>;
  getCall(id: string): Promise<CallRecord | null>;
  listCalls(): Promise<Pick<CallRecord, 'id' | 'title' | 'startedAt' | 'durationSec' | 'mode'>[]>;
  saveAudio(id: string, filePath: string, mime: string): Promise<void>;
  audio(id: string): Promise<AudioRef | null>;
}

const ext = (mime: string) => (mime === 'audio/ogg' ? 'ogg' : 'wav');

/** פיתוח בלי Supabase: תיקייה לכל שיחה תחת DATA_DIR */
class LocalStore implements Store {
  private dir = (id: string) => path.join(cfg.dataDir, id);

  async saveCall(c: CallRecord) {
    await fs.mkdir(this.dir(c.id), { recursive: true });
    await fs.writeFile(path.join(this.dir(c.id), 'call.json'), JSON.stringify(c, null, 2));
  }
  async getCall(id: string) {
    try { return JSON.parse(await fs.readFile(path.join(this.dir(id), 'call.json'), 'utf8')) as CallRecord; }
    catch { return null; }
  }
  async listCalls() {
    let ids: string[] = [];
    try { ids = await fs.readdir(cfg.dataDir); } catch { return []; }
    const calls = await Promise.all(ids.map((id) => this.getCall(id)));
    return calls.filter((c): c is CallRecord => !!c)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(({ id, title, startedAt, durationSec, mode }) => ({ id, title, startedAt, durationSec, mode }));
  }
  async saveAudio(id: string, filePath: string, mime: string) {
    await fs.mkdir(this.dir(id), { recursive: true });
    await fs.copyFile(filePath, path.join(this.dir(id), `audio.${ext(mime)}`));
  }
  async audio(id: string) {
    const c = await this.getCall(id);
    if (!c?.audioMime) return null;
    return { path: path.join(this.dir(id), `audio.${ext(c.audioMime)}`), mime: c.audioMime };
  }
}

/** ייצור: טבלת calls + bucket recordings. ראה supabase/migrations. */
class SupabaseStore implements Store {
  private db: SupabaseClient;
  constructor() { this.db = createClient(cfg.supabaseUrl!, cfg.supabaseKey!); }

  private row = (c: CallRecord) => ({
    id: c.id, title: c.title, platform: c.platform, participants: c.participants, started_at: c.startedAt,
    duration_sec: c.durationSec, mode: c.mode, language: c.language, provider: c.provider, segments: c.segments,
    markers: c.markers, summary: c.summary, audio_mime: c.audioMime, audio_expires_at: c.audioExpiresAt, est_cost_usd: c.estCostUsd, error: c.error ?? null,
  });
  private fromRow = (r: any): CallRecord => ({
    id: r.id, title: r.title, platform: r.platform, participants: r.participants ?? [], startedAt: r.started_at,
    durationSec: r.duration_sec, mode: r.mode, language: r.language, provider: r.provider, segments: r.segments ?? [],
    markers: r.markers ?? [], summary: r.summary, audioMime: r.audio_mime, audioExpiresAt: r.audio_expires_at, estCostUsd: Number(r.est_cost_usd ?? 0), error: r.error ?? undefined,
  });

  async saveCall(c: CallRecord) {
    const { error } = await this.db.from('calls').upsert(this.row(c));
    if (error) throw error;
  }
  async getCall(id: string) {
    const { data } = await this.db.from('calls').select('*').eq('id', id).maybeSingle();
    return data ? this.fromRow(data) : null;
  }
  async listCalls() {
    const { data } = await this.db.from('calls').select('id,title,started_at,duration_sec,mode').order('started_at', { ascending: false }).limit(100);
    return (data ?? []).map((r: any) => ({ id: r.id, title: r.title, startedAt: r.started_at, durationSec: r.duration_sec, mode: r.mode }));
  }
  async saveAudio(id: string, filePath: string, mime: string) {
    const bytes = await fs.readFile(filePath);
    const { error } = await this.db.storage.from('recordings').upload(`${id}/audio.${ext(mime)}`, bytes, { contentType: mime, upsert: true });
    if (error) throw error;
  }
  async audio(id: string) {
    const c = await this.getCall(id);
    if (!c?.audioMime) return null;
    const { data } = await this.db.storage.from('recordings').createSignedUrl(`${id}/audio.${ext(c.audioMime)}`, 3600);
    return data ? { url: data.signedUrl, mime: c.audioMime } : null;
  }
}

export const store: Store = cfg.supabaseUrl && cfg.supabaseKey ? new SupabaseStore() : new LocalStore();
