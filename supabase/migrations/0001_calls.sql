-- Si-kam-nu: שיחה אחת = שורה אחת. segments ו-summary כ-jsonb.
-- ponytail: כשמגיע חיפוש חוצה שיחות (P1) מנרמלים segments לטבלה עם tsvector. עד אז jsonb מספיק.

create table if not exists calls (
  id uuid primary key,
  user_id uuid,                                   -- ריק עד שיש אימות משתמשים
  title text not null,
  platform text not null default 'unknown',       -- meet | zoom | unknown
  participants text[] not null default '{}',
  started_at timestamptz not null,
  duration_sec integer not null default 0,
  mode text not null check (mode in ('live', 'batch')),
  language text not null check (language in ('he', 'multi')),
  provider text not null,                         -- deepgram | assemblyai
  segments jsonb not null default '[]',
  markers jsonb not null default '[]',
  summary jsonb,
  audio_mime text,
  audio_expires_at timestamptz,                   -- PRD סעיף 10: 90 יום כברירת מחדל
  est_cost_usd numeric(8,4) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists calls_started_at_idx on calls (started_at desc);

insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- ponytail: RLS ומדיניות לפי user_id נכנסים יחד עם ההתחברות בגוגל. כרגע service key בלבד מהשרת.
