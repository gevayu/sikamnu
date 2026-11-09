const env = process.env;
const port = Number(env.PORT ?? 8787);

export const cfg = {
  port,
  publicUrl: env.PUBLIC_URL ?? `http://localhost:${port}`,
  authToken: env.AUTH_TOKEN ?? 'dev-token',
  dataDir: env.DATA_DIR ?? 'data',
  deepgramKey: env.DEEPGRAM_API_KEY ?? '',
  assemblyKey: env.ASSEMBLYAI_API_KEY ?? '',
  aaiSpeechModel: env.AAI_SPEECH_MODEL || undefined,
  liveProvider: env.STT_LIVE_PROVIDER || undefined,
  batchProvider: env.STT_BATCH_PROVIDER || undefined,
  anthropicKey: env.ANTHROPIC_API_KEY ?? '',
  summaryModel: env.SUMMARY_MODEL ?? 'claude-sonnet-5',
  supabaseUrl: env.SUPABASE_URL || undefined,
  supabaseKey: env.SUPABASE_SERVICE_KEY || undefined,
  /** אחסון אודיו, ימים. ה-PRD: 90 כברירת מחדל. */
  audioRetentionDays: Number(env.AUDIO_RETENTION_DAYS ?? 90),
};
