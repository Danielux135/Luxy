-- =============================================================================
-- Luxy - esquema inicial
-- Migracion acumulativa. NO modificar una vez aplicada: crear una nueva.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- tipos enumerados
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'luxy_job_status') then
    create type luxy_job_status as enum (
      'queued',
      'waiting_for_machine',
      'claimed',
      'running',
      'waiting_for_approval',
      'completed',
      'failed',
      'cancelled',
      'interrupted'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'luxy_update_status') then
    create type luxy_update_status as enum ('received', 'processed', 'failed', 'ignored');
  end if;

  if not exists (select 1 from pg_type where typname = 'luxy_approval_status') then
    create type luxy_approval_status as enum ('pending', 'approved', 'rejected', 'expired');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- funcion auxiliar: mantiene updated_at
-- -----------------------------------------------------------------------------
create or replace function luxy_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- telegram_updates: idempotencia de los updates entrantes
-- -----------------------------------------------------------------------------
create table if not exists public.telegram_updates (
  update_id     bigint primary key,
  received_at   timestamptz not null default now(),
  status        luxy_update_status not null default 'received',
  error_message text
);

create index if not exists telegram_updates_received_at_idx
  on public.telegram_updates (received_at desc);

-- -----------------------------------------------------------------------------
-- telegram_users: lista blanca de usuarios y su maquina preferida
-- -----------------------------------------------------------------------------
create table if not exists public.telegram_users (
  telegram_user_id     bigint primary key,
  username             text,
  authorized           boolean not null default false,
  preferred_machine_id uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists telegram_users_touch on public.telegram_users;
create trigger telegram_users_touch
  before update on public.telegram_users
  for each row execute function luxy_touch_updated_at();

-- -----------------------------------------------------------------------------
-- machines: cada instalacion de luxy en un ordenador
-- -----------------------------------------------------------------------------
create table if not exists public.machines (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  hostname         text not null,
  platform         text not null,
  platform_version text not null default '',
  agent_version    text not null default '',
  capabilities     jsonb not null default '{}'::jsonb,
  projects         text[] not null default '{}',
  last_seen_at     timestamptz,
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- el nombre identifica la maquina para el usuario: debe ser unico
  constraint machines_name_unique unique (name),
  constraint machines_name_format check (name ~ '^[a-z0-9][a-z0-9-]{0,47}$')
);

create index if not exists machines_last_seen_idx on public.machines (last_seen_at desc);
create index if not exists machines_enabled_idx on public.machines (enabled) where enabled;

drop trigger if exists machines_touch on public.machines;
create trigger machines_touch
  before update on public.machines
  for each row execute function luxy_touch_updated_at();

-- la maquina preferida debe existir; si se borra, el usuario se queda sin preferencia
alter table public.telegram_users
  drop constraint if exists telegram_users_preferred_machine_fk;
alter table public.telegram_users
  add constraint telegram_users_preferred_machine_fk
  foreign key (preferred_machine_id) references public.machines (id) on delete set null;

-- -----------------------------------------------------------------------------
-- machine_tokens: solo el hash del token, nunca el token en claro
-- -----------------------------------------------------------------------------
create table if not exists public.machine_tokens (
  id         uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines (id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint machine_tokens_hash_unique unique (token_hash)
);

create index if not exists machine_tokens_machine_idx on public.machine_tokens (machine_id);
-- indice parcial para la busqueda habitual: tokens vivos
create index if not exists machine_tokens_active_idx
  on public.machine_tokens (token_hash) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- jobs: la cola de trabajos
-- -----------------------------------------------------------------------------
create table if not exists public.jobs (
  id                  uuid primary key default gen_random_uuid(),
  short_id            text not null,
  telegram_chat_id    bigint not null,
  telegram_user_id    bigint not null,
  target_machine_id   uuid references public.machines (id) on delete set null,
  provider            text not null,
  project_alias       text not null,
  prompt              text not null,
  status              luxy_job_status not null default 'queued',
  priority            integer not null default 0,
  claimed_by          uuid references public.machines (id) on delete set null,
  claimed_at          timestamptz,
  lease_expires_at    timestamptz,
  cancel_requested_at timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  result_summary      text,
  error_message       text,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint jobs_short_id_unique unique (short_id),
  constraint jobs_provider_check check (provider in ('claude','codex','deepseek','glm','qwen')),
  constraint jobs_priority_check check (priority between -100 and 100)
);

-- indice principal de la cola: se consulta por estado y prioridad
create index if not exists jobs_queue_idx
  on public.jobs (status, priority desc, created_at asc)
  where status in ('queued', 'waiting_for_machine');

create index if not exists jobs_claimed_by_idx on public.jobs (claimed_by)
  where status in ('claimed', 'running', 'waiting_for_approval');

create index if not exists jobs_lease_idx on public.jobs (lease_expires_at)
  where status in ('claimed', 'running');

create index if not exists jobs_chat_idx on public.jobs (telegram_chat_id, created_at desc);
create index if not exists jobs_short_id_idx on public.jobs (short_id);

drop trigger if exists jobs_touch on public.jobs;
create trigger jobs_touch
  before update on public.jobs
  for each row execute function luxy_touch_updated_at();

-- -----------------------------------------------------------------------------
-- job_events: progreso incremental
-- -----------------------------------------------------------------------------
create table if not exists public.job_events (
  id         bigserial primary key,
  job_id     uuid not null references public.jobs (id) on delete cascade,
  sequence   integer not null,
  type       text not null,
  message    text not null default '',
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- la secuencia hace idempotente el reenvio de eventos encolados
  constraint job_events_sequence_unique unique (job_id, sequence),
  constraint job_events_type_check check (
    type in ('phase','log','provider_output','test_result','diff_summary','warning','error')
  )
);

create index if not exists job_events_job_idx on public.job_events (job_id, sequence);

-- -----------------------------------------------------------------------------
-- approvals: auditoria de acciones que exigen confirmacion explicita
-- -----------------------------------------------------------------------------
create table if not exists public.approvals (
  id                          uuid primary key default gen_random_uuid(),
  job_id                      uuid not null references public.jobs (id) on delete cascade,
  action                      text not null,
  status                      luxy_approval_status not null default 'pending',
  requested_at                timestamptz not null default now(),
  resolved_at                 timestamptz,
  resolved_by_telegram_user_id bigint,
  metadata                    jsonb not null default '{}'::jsonb,
  constraint approvals_action_check check (action in ('commit','discard','push'))
);

create index if not exists approvals_job_idx on public.approvals (job_id);
create index if not exists approvals_pending_idx on public.approvals (status)
  where status = 'pending';

-- -----------------------------------------------------------------------------
-- provider_usage: consumo de las apis http
-- -----------------------------------------------------------------------------
create table if not exists public.provider_usage (
  id             bigserial primary key,
  provider       text not null,
  model          text not null,
  job_id         uuid references public.jobs (id) on delete set null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  estimated_cost numeric(12, 6) not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists provider_usage_provider_day_idx
  on public.provider_usage (provider, created_at desc);

-- =============================================================================
-- RLS: todo denegado por defecto.
-- El unico cliente es el Cloudflare Worker con la service role key, que
-- omite RLS. anon y authenticated no reciben NINGUN permiso.
-- =============================================================================
alter table public.telegram_updates enable row level security;
alter table public.telegram_users   enable row level security;
alter table public.machines         enable row level security;
alter table public.machine_tokens   enable row level security;
alter table public.jobs             enable row level security;
alter table public.job_events       enable row level security;
alter table public.approvals        enable row level security;
alter table public.provider_usage   enable row level security;

-- se fuerza RLS tambien para el propietario de las tablas
alter table public.machine_tokens force row level security;
alter table public.telegram_users force row level security;

-- revocacion explicita: ningun rol publico toca estos datos
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
