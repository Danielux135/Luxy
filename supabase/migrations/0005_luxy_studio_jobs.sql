-- =============================================================================
-- Luxy - trabajos creados desde Studio y Mobile
-- Migracion acumulativa. NO modifica 0001-0004 y no depende de Luxy Remote.
--
-- ESTADO: preparada, NO aplicada automaticamente.
-- =============================================================================

-- Telegram deja de ser una identidad obligatoria del trabajo. Los registros
-- existentes conservan created_via='telegram' mediante el valor por defecto.
alter table public.jobs
  alter column telegram_chat_id drop not null,
  alter column telegram_user_id drop not null;

alter table public.jobs
  add column if not exists created_via text not null default 'telegram';

alter table public.jobs
  drop constraint if exists jobs_created_via_check;

alter table public.jobs
  add constraint jobs_created_via_check
  check (created_via in ('telegram', 'studio', 'mobile'));

-- Un trabajo de Telegram sigue exigiendo ambos ids. Studio y Mobile no pueden
-- introducir un unico id suelto que parezca una identidad valida.
alter table public.jobs
  drop constraint if exists jobs_telegram_identity_check;

alter table public.jobs
  add constraint jobs_telegram_identity_check
  check (
    (created_via = 'telegram' and telegram_chat_id is not null and telegram_user_id is not null)
    or
    (created_via <> 'telegram' and telegram_chat_id is null and telegram_user_id is null)
  );

create index if not exists jobs_created_via_idx
  on public.jobs (created_via, created_at desc);

-- Los identificadores de API pueden incluir namespace (por ejemplo
-- organization/model) o dos puntos. Siguen sin poder empezar por guion ni
-- contener espacios o caracteres de control.
alter table public.jobs
  drop constraint if exists jobs_model_check;

alter table public.jobs
  add constraint jobs_model_check
  check (model is null or model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$');

-- Cambia la forma devuelta por la funcion: PostgreSQL no permite hacerlo con
-- CREATE OR REPLACE, por eso se elimina y recrea en la misma migracion.
drop function if exists public.luxy_claim_job(uuid, text[], text[], integer);

create or replace function public.luxy_claim_job(
  p_machine_id uuid,
  p_providers  text[],
  p_projects   text[],
  p_lease_seconds integer default 120
)
returns table (
  id                uuid,
  short_id          text,
  provider          text,
  model             text,
  project_alias     text,
  prompt            text,
  created_via       text,
  telegram_chat_id  bigint,
  telegram_user_id  bigint,
  lease_expires_at  timestamptz,
  metadata          jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_lease  timestamptz;
begin
  if not exists (
    select 1 from public.machines m
    where m.id = p_machine_id and m.enabled
  ) then
    return;
  end if;

  if p_lease_seconds is null or p_lease_seconds < 30 then
    p_lease_seconds := 120;
  end if;

  v_lease := now() + make_interval(secs => p_lease_seconds);

  select j.id
    into v_job_id
    from public.jobs j
   where j.cancel_requested_at is null
     and j.provider = any (p_providers)
     and j.project_alias = any (p_projects)
     and (j.target_machine_id is null or j.target_machine_id = p_machine_id)
     and (
          j.status in ('queued', 'waiting_for_machine')
          or
          (
            j.status = 'claimed'
            and j.started_at is null
            and j.lease_expires_at is not null
            and j.lease_expires_at < now()
          )
         )
   order by j.priority desc, j.created_at asc
   limit 1
     for update skip locked;

  if v_job_id is null then
    return;
  end if;

  update public.jobs j
     set status            = 'claimed',
         claimed_by        = p_machine_id,
         target_machine_id = p_machine_id,
         claimed_at        = now(),
         lease_expires_at  = v_lease
   where j.id = v_job_id;

  return query
    select j.id,
           j.short_id,
           j.provider,
           j.model,
           j.project_alias,
           j.prompt,
           j.created_via,
           j.telegram_chat_id,
           j.telegram_user_id,
           j.lease_expires_at,
           j.metadata
      from public.jobs j
     where j.id = v_job_id;
end;
$$;

-- PostgreSQL concede EXECUTE sobre funciones nuevas a PUBLIC por defecto.
-- Revocar solo a anon/authenticated no basta, porque ambos heredan PUBLIC.
revoke all on function public.luxy_claim_job(uuid, text[], text[], integer)
  from public, anon, authenticated;
revoke all on function public.luxy_renew_lease(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.luxy_expire_leases()
  from public, anon, authenticated;
revoke all on function public.luxy_request_cancel(uuid)
  from public, anon, authenticated;

grant execute on function public.luxy_claim_job(uuid, text[], text[], integer)
  to service_role;
grant execute on function public.luxy_renew_lease(uuid, uuid, integer)
  to service_role;
grant execute on function public.luxy_expire_leases()
  to service_role;
grant execute on function public.luxy_request_cancel(uuid)
  to service_role;
