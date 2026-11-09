/**
 * תמלול מחדש של הקלטה ששמורה כקובץ WAV סטריאו (ערוץ 0 אני, ערוץ 1 הם).
 * לשיחה שהתמלול שלה נכשל, או לקובץ שנשאר בתיקייה הזמנית אחרי קריסה.
 *
 *   node --env-file=../.env src/recover.ts <file.wav> [he|multi] [כותרת] [callId]
 *
 * עם callId קיים: מעדכן את השיחה הזו במקום ליצור חדשה.
 * ponytail: CLI ידני. כשיגיע כפתור "תמלל מחדש" בעמוד השיחה (PRD סעיף 6), הוא יקרא לאותה פונקציה מהשרת.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { toOpus } from './audio.ts';
import { cfg } from './config.ts';
import { checkProviders } from './health.ts';
import { nameSpeakers } from './speakers.ts';
import { estimateCost, providerChain } from './stt/index.ts';
import type { Lang } from './stt/types.ts';
import { store, type CallRecord } from './store.ts';
import { summarize } from './summarize.ts';

const [wavPath, lang = 'he', title, existingId] = process.argv.slice(2);
if (!wavPath) { console.error('usage: recover.ts <file.wav> [he|multi] [title] [callId]'); process.exit(2); }

const wav = await fs.readFile(wavPath);
const channels = wav.readUInt16LE(22), sampleRate = wav.readUInt32LE(24);
const durationSec = Math.round((wav.length - 44) / (sampleRate * channels * 2));
const opts = { language: lang as Lang, sampleRate, channels, keyterms: [] };
console.log(`[recover] ${wavPath}: ${durationSec}s, ${channels}ch ${sampleRate}Hz, ${lang}`);

await checkProviders();
const prev = existingId ? await store.getCall(existingId) : null;
let segments, provider;
for (const p of providerChain('batch', opts.language)) {
  try { segments = await p.transcribeFile(wav, opts); provider = p; break; }
  catch (e) { console.error(`[recover] ${p.id} נכשל:`, e instanceof Error ? e.message : e); }
}
if (!segments || !provider) { console.error('[recover] כל הספקים נכשלו. הקובץ לא נגע.'); process.exit(1); }
segments = nameSpeakers(segments, []);
console.log(`[recover] ${segments.length} segments via ${provider.id}`);

const meta = { title: title || prev?.title || '', participants: prev?.participants ?? [], language: lang };
const summary = await summarize(segments, meta).catch((e) => { console.error('[summarize]', e); return null; });

const id = prev?.id ?? randomUUID();
const ogg = wavPath.replace(/\.wav$/i, '') + '.recover.ogg';
const opus = await toOpus(wavPath, ogg);
const record: CallRecord = {
  id,
  title: meta.title || `שיחה ${new Date().toLocaleDateString('he-IL')}`,
  platform: prev?.platform ?? 'unknown',
  participants: meta.participants,
  startedAt: prev?.startedAt ?? (await fs.stat(wavPath)).mtime.toISOString(),
  durationSec,
  mode: 'batch', language: opts.language, provider: provider.id,
  segments, markers: prev?.markers ?? [], summary,
  audioMime: opus ? 'audio/ogg' : 'audio/wav',
  audioExpiresAt: new Date(Date.now() + cfg.audioRetentionDays * 86_400_000).toISOString(),
  estCostUsd: estimateCost(provider, 'batch', durationSec / 60),
};
await store.saveCall(record);
await store.saveAudio(id, opus ? ogg : wavPath, record.audioMime!);
if (opus) await fs.rm(ogg, { force: true });
console.log(`[recover] saved: ${cfg.publicUrl}/calls/${id}`);
