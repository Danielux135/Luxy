-- =============================================================================
-- Luxy - reclamacion atomica de trabajos y mantenimiento de leases
-- Migracion acumulativa. NO modificar una vez aplicada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- luxy_claim_job
--
-- Devuelve como maximo UN trabajo y lo marca como reclamado en la misma
-- transaccion. La exclusion mutua se consigue con FOR UPDATE SKIP LOCKED:
-- si dos maquinas llaman a la vez, la segunda salta la fila bloqueada por la
-- primera y nunca obtiene el mismo trabajo.
--
-- Reglas aplicadas:
--   * ignora maquinas deshabilitadas
--   * respeta target_machine_id cuando esta fijado
--   * acepta trabajos sin maquina objetivo si la maquina es compatible
--   * exige que la maquina tenga el proyecto y sepa ejecutar el proveedor
--   * ignora trabajos con cancelacion solicitada
--   * recupera trabajos con lease caducado SOLO cuando es seguro
--     (estado 'claimed' y started_at nulo: nadie llego a tocar archivos)
--   * actualiza el lease de la fila devuelta
-- -----------------------------------------------------------------------------
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
  project_alias     text,
  prompt            text,
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
  -- una maquina deshabilitada o inexistente nunca reclama nada
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

  -- se selecciona y bloquea una unica fila candidata
  select j.id
    into v_job_id
    from public.jobs j
   where j.cancel_requested_at is null
     and j.provider = any (p_providers)
     and j.project_alias = any (p_projects)
     and (j.target_machine_id is null or j.target_machine_id = p_machine_id)
     and (
          -- trabajos que nunca han sido reclamados
          j.status in ('queued', 'waiting_for_machine')
          or
          -- recuperacion segura: reclamado, lease caducado y sin empezar.
          -- si started_at no es nulo puede haber cambios locales sin guardar,
          -- asi que NO se reasigna automaticamente a otra maquina.
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
           j.project_alias,
           j.prompt,
           j.telegram_chat_id,
           j.telegram_user_id,
           j.lease_expires_at,
           j.metadata
      from public.jobs j
     where j.id = v_job_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- luxy_renew_lease
-- Renueva el lease solo si la maquina indicada sigue siendo la propietaria.
-- Devuelve la nueva fecha o null si la maquina ya perdio el trabajo.
-- -----------------------------------------------------------------------------
create or replace function public.luxy_renew_lease(
  p_job_id        uuid,
  p_machine_id    uuid,
  p_lease_seconds integer default 120
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease timestamptz;
begin
  if p_lease_seconds is null or p_lease_seconds < 30 then
    p_lease_seconds := 120;
  end if;

  update public.jobs j
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where j.id = p_job_id
     and j.claimed_by = p_machine_id
     and j.status in ('claimed', 'running', 'waiting_for_approval')
  returning j.lease_expires_at into v_lease;

  return v_lease;
end;
$$;

-- -----------------------------------------------------------------------------
-- luxy_expire_leases
-- Barrido periodico de leases caducados.
--   * trabajos 'claimed' sin empezar -> vuelven a la cola (seguro)
--   * trabajos 'running' o ya empezados -> 'interrupted', NUNCA se reasignan
--     solos, porque la maquina pudo dejar cambios en el worktree.
-- Devuelve cuantas filas cambio en cada categoria.
-- -----------------------------------------------------------------------------
create or replace function public.luxy_expire_leases()
returns table (requeued integer, interrupted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requeued    integer := 0;
  v_interrupted integer := 0;
begin
  with requeued as (
    update public.jobs j
       set status           = 'queued',
           claimed_by       = null,
           claimed_at       = null,
           lease_expires_at = null
     where j.status = 'claimed'
       and j.started_at is null
       and j.lease_expires_at is not null
       and j.lease_expires_at < now()
    returning 1
  )
  select count(*)::integer into v_requeued from requeued;

  with stalled as (
    update public.jobs j
       set status        = 'interrupted',
           completed_at  = now(),
           error_message = coalesce(
             j.error_message,
             'la maquina dejo de responder durante la ejecucion; los cambios locales se conservan'
           )
     where j.status in ('claimed', 'running', 'waiting_for_approval')
       and j.started_at is not null
       and j.lease_expires_at is not null
       and j.lease_expires_at < now()
    returning 1
  )
  select count(*)::integer into v_interrupted from stalled;

  return query select v_requeued, v_interrupted;
end;
$$;

-- -----------------------------------------------------------------------------
-- luxy_request_cancel
-- Marca la peticion de cancelacion. El agente la detecta por polling.
-- No borra nada: los cambios del worktree se conservan siempre.
-- -----------------------------------------------------------------------------
create or replace function public.luxy_request_cancel(p_job_id uuid)
returns luxy_job_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status luxy_job_status;
begin
  update public.jobs j
     set cancel_requested_at = coalesce(j.cancel_requested_at, now()),
         -- si aun no lo habia cogido ninguna maquina, se cancela directamente
         status = case
                    when j.status in ('queued', 'waiting_for_machine') then 'cancelled'::luxy_job_status
                    else j.status
                  end,
         completed_at = case
                          when j.status in ('queued', 'waiting_for_machine') then now()
                          else j.completed_at
                        end
   where j.id = p_job_id
     and j.status not in ('completed', 'failed', 'cancelled', 'interrupted')
  returning j.status into v_status;

  return v_status;
end;
$$;

-- las funciones solo las invoca el worker con la service role key
revoke all on function public.luxy_claim_job(uuid, text[], text[], integer) from anon, authenticated;
revoke all on function public.luxy_renew_lease(uuid, uuid, integer) from anon, authenticated;
revoke all on function public.luxy_expire_leases() from anon, authenticated;
revoke all on function public.luxy_request_cancel(uuid) from anon, authenticated;
