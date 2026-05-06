-- ── Elite Reclutamiento CRM — Supabase Schema ────────────────────────────────
-- Run this in Supabase Dashboard → SQL Editor

-- LEADS
create table if not exists leads (
  id                        text primary key,
  nombre                    text,
  correo                    text,
  telefono                  text,
  fuente                    text,
  etapa                     text,
  pipeline_id               text,
  estado                    text default 'abierto',
  valor                     numeric,
  propietario               text,
  ubicacion                 text,
  nombre_lead               text,
  etiquetas                 jsonb default '[]',
  notas                     jsonb default '[]',
  tareas                    jsonb default '[]',
  pagos                     jsonb default '[]',
  historial                 jsonb default '[]',
  meta_wa                   jsonb default '[]',
  telefonos_extra           jsonb default '[]',
  cita                      jsonb,
  quiere_entrevista         boolean default false,
  sin_manager               boolean default false,
  unread_msg                boolean default false,
  webinar_email_enviado     timestamptz,
  webinar_accion            text,
  inscrito_webinar          boolean default false,
  webinar_intent            boolean default false,
  webinar_visto_pct         numeric,
  webinar_tiempo_visto      numeric,
  fecha_inscripcion_webinar timestamptz,
  inscrito_por              text,
  seguidores                jsonb default '[]',
  ia_paused                 boolean default false,
  interview_state           text,
  pending_slots             text,
  tiene_experiencia         boolean,
  tiene_papeles             boolean,
  mayor_edad                boolean,
  vio_webinar               boolean,
  disponibilidad            text,
  contacto                  text,
  link_webinar              text,
  webinar_pausas            integer,
  webinar_completado        boolean default false,
  webinar_ultima_sesion     timestamptz,
  webinar_ultimo_evento     text,
  quiere_entrevista_fecha   timestamptz,
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);
create index if not exists idx_leads_pipeline on leads(pipeline_id);
create index if not exists idx_leads_telefono on leads(telefono);

-- WA MESSAGES
create table if not exists wa_messages (
  id         text primary key,
  phone      text not null,
  direction  text not null,
  text       text,
  ts         bigint,
  status     text,
  wamid      text,
  error_code integer,
  created_at timestamptz default now()
);
create index if not exists idx_wa_messages_phone on wa_messages(phone);
create index if not exists idx_wa_messages_ts    on wa_messages(ts desc);

-- SESSIONS
create table if not exists sessions (
  id         text primary key,
  user_id    text,
  name       text,
  role       text,
  phone      text,
  verified   boolean default false,
  expires    bigint,
  created_at timestamptz default now()
);

-- USERS
create table if not exists users (
  id            text primary key,
  nombre        text,
  correo        text,
  telefono      text,
  password_hash text,
  role          text,
  active        boolean default true,
  created_at    timestamptz default now()
);

-- CONFIG (key-value for wa_token, wa_hours, ai_config, etc.)
create table if not exists config (
  key        text primary key,
  value      jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- WEBHOOK LOG
create table if not exists webhook_log (
  id         text primary key,
  ts         timestamptz,
  type       text,
  phone      text,
  preview    text,
  raw        text,
  created_at timestamptz default now()
);
create index if not exists idx_webhook_log_ts on webhook_log(ts desc);

-- ESCALATIONS
create table if not exists escalations (
  id         text primary key,
  lead_phone text,
  lead_id    text,
  data       jsonb default '{}',
  created_at timestamptz default now()
);
create index if not exists idx_escalations_phone on escalations(lead_phone);

-- TEAM MESSAGES
create table if not exists team_messages (
  id         text primary key,
  phone      text,
  name       text,
  direction  text,
  text       text,
  ts         timestamptz,
  created_at timestamptz default now()
);

-- CALL LOG
create table if not exists call_log (
  id            text primary key,
  call_sid      text,
  from_number   text,
  to_number     text,
  status        text,
  direction     text,
  duration      integer,
  type          text,
  label         text,
  recording_url text,
  transcription text,
  ts            bigint,
  start_time    timestamptz,
  created_at    timestamptz default now()
);

-- INTERVIEWS
create table if not exists interviews (
  id         text primary key,
  lead_phone text,
  lead_name  text,
  slot_iso   timestamptz,
  status     text,
  zoom_link  text,
  conv_key   text,
  data       jsonb default '{}',
  created_at timestamptz default now()
);
create index if not exists idx_interviews_phone    on interviews(lead_phone);
create index if not exists idx_interviews_conv_key on interviews(conv_key);
create index if not exists idx_interviews_slot     on interviews(slot_iso);

-- Disable RLS (server uses service role key)
alter table leads          disable row level security;
alter table wa_messages    disable row level security;
alter table sessions       disable row level security;
alter table users          disable row level security;
alter table config         disable row level security;
alter table webhook_log    disable row level security;
alter table escalations    disable row level security;
alter table team_messages  disable row level security;
alter table call_log       disable row level security;
alter table interviews     disable row level security;
