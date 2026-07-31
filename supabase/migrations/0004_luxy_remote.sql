-- -----------------------------------------------------------------------------
-- Luxy Remote: dispositivos emparejados, codigos de emparejamiento y sesiones.
--
-- NO EJECUTADA. Requiere autorizacion explicita del usuario.
--
-- QUE NO SE GUARDA AQUI, y es deliberado:
--   * ninguna clave PRIVADA (viven en DPAPI y en Android Keystore)
--   * ningun frame de video ni de audio
--   * ningun contenido de portapapeles
--   * ningun archivo transferido
--   * ninguna credencial TURN permanente
--
-- Lo que si: claves publicas, permisos, estado y auditoria. Lo justo para poder
-- verificar identidades y enrutar sesiones.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- remote_devices
--
-- Se separa de `machines` a proposito: una maquina es "un ordenador que ejecuta
-- el agente de IA"; un remote_device es "algo que puede abrir una sesion
-- remota". Un movil es lo segundo y nunca lo primero, y mezclarlos obligaria a
-- llenar `machines` de columnas que no aplican.
-- -----------------------------------------------------------------------------
create table if not exists public.remote_devices (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  kind            text not null check (kind in ('desktop', 'android')),

  -- clave publica P-256 sin comprimir, en base64url. NUNCA la privada.
  public_key      text not null,
  fingerprint     text not null,

  -- con quien esta emparejado
  peer_device_id  uuid references public.remote_devices (id) on delete cascade,

  -- capacidades concedidas a este dispositivo. Vacio = no puede hacer nada.
  permissions     text[] not null default '{}',

  -- acceso sin confirmacion local. Desactivado por defecto a proposito.
  unattended      boolean not null default false,
  require_biometrics boolean not null default false,

  paired_at       timestamptz not null default now(),
  last_seen_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- una clave publica identifica a UN dispositivo. Si se repitiera, dos
-- dispositivos podrian firmar el uno por el otro.
create unique index if not exists remote_devices_public_key_key
  on public.remote_devices (public_key);

create index if not exists remote_devices_active_idx
  on public.remote_devices (revoked_at) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- remote_pairing_codes
--
-- Codigos de un solo uso y vida corta. El estado es lo que impide que alguien
-- que fotografio el QR se empareje despues del movil legitimo.
-- -----------------------------------------------------------------------------
create table if not exists public.remote_pairing_codes (
  code            text primary key check (code ~ '^[0-9]{8}$'),
  host_device_id  uuid not null references public.remote_devices (id) on delete cascade,

  state           text not null default 'waiting'
                  check (state in ('waiting','claimed','confirmed','rejected','expired','used')),

  -- clave del que reclama, hasta que se confirma
  claimant_public_key text,
  claimant_name       text,
  claimant_kind       text check (claimant_kind in ('desktop','android')),

  -- confirmaciones. HACEN FALTA LAS DOS: con una sola, un gateway que hubiera
  -- sustituido una clave solo necesitaria enganar a un lado.
  host_confirmed      boolean not null default false,
  claimant_confirmed  boolean not null default false,

  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  resolved_at     timestamptz
);

create index if not exists remote_pairing_codes_expiry_idx
  on public.remote_pairing_codes (expires_at) where state = 'waiting';

-- -----------------------------------------------------------------------------
-- remote_sessions
--
-- Metadatos y metricas AGREGADAS. Nunca contenido.
-- -----------------------------------------------------------------------------
create table if not exists public.remote_sessions (
  id              uuid primary key default gen_random_uuid(),
  host_device_id  uuid not null references public.remote_devices (id) on delete cascade,
  client_device_id uuid not null references public.remote_devices (id) on delete cascade,

  -- lo que se concedio DE VERDAD, que puede ser menos de lo pedido
  granted         text[] not null default '{}',
  mode            text not null default 'attended' check (mode in ('attended','unattended')),

  state           text not null default 'negotiating'
                  check (state in ('negotiating','active','ended','failed')),

  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  end_reason      text,

  -- si fue directa o por relay: cambia latencia y consumo, hay que poder verlo
  relayed         boolean,
  -- bytes aproximados, para vigilar la cuota gratuita de TURN
  bytes_relayed   bigint not null default 0,

  created_at      timestamptz not null default now()
);

create index if not exists remote_sessions_host_idx
  on public.remote_sessions (host_device_id, started_at desc);

create index if not exists remote_sessions_active_idx
  on public.remote_sessions (state) where state = 'active';

-- -----------------------------------------------------------------------------
-- remote_auth_nonces
--
-- Cada peticion firmada lleva un nonce. Registrarlo AQUI, con el nonce como
-- clave primaria, hace que comprobar y registrar sean la MISMA operacion
-- atomica: dos peticiones identicas simultaneas no pueden pasar las dos.
--
-- Leer primero y escribir despues dejaria una ventana entre ambas en la que las
-- dos verian el nonce como nuevo, que es justo el replay que se quiere impedir.
--
-- Las filas caducan: solo hace falta recordar un nonce mientras su marca de
-- tiempo siga dentro de la ventana de validez.
-- -----------------------------------------------------------------------------
create table if not exists public.remote_auth_nonces (
  nonce       text primary key,
  device_id   uuid not null references public.remote_devices (id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists remote_auth_nonces_expiry_idx
  on public.remote_auth_nonces (expires_at);

-- limpieza de nonces caducados; se llama desde el cron que ya existe
create or replace function public.luxy_purge_auth_nonces()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_borrados integer := 0;
begin
  with borrados as (
    delete from public.remote_auth_nonces where expires_at < now() returning 1
  )
  select count(*)::integer into v_borrados from borrados;
  return v_borrados;
end;
$$;

-- -----------------------------------------------------------------------------
-- remote_audit
--
-- Append-only. Sin esto, revocar un dispositivo no deja constancia de que
-- existio, y despues de perder un movil eso es justo lo que hace falta saber.
-- -----------------------------------------------------------------------------
create table if not exists public.remote_audit (
  id              bigserial primary key,
  device_id       uuid references public.remote_devices (id) on delete set null,
  session_id      uuid references public.remote_sessions (id) on delete set null,
  action          text not null,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists remote_audit_device_idx
  on public.remote_audit (device_id, created_at desc);

-- -----------------------------------------------------------------------------
-- caducidad de codigos
--
-- Un codigo caducado que siga en 'waiting' se podria reclamar si el reloj del
-- cliente mintiera. Se marca desde el servidor, que es el reloj que manda.
-- -----------------------------------------------------------------------------
create or replace function public.luxy_expire_pairing_codes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expirados integer := 0;
begin
  with caducados as (
    update public.remote_pairing_codes
       set state = 'expired', resolved_at = now()
     where state in ('waiting', 'claimed')
       and expires_at < now()
    returning 1
  )
  select count(*)::integer into v_expirados from caducados;

  return v_expirados;
end;
$$;

-- -----------------------------------------------------------------------------
-- permisos
--
-- Igual que el resto del esquema de Luxy: solo el service role del Worker toca
-- estas tablas. Los clientes NUNCA hablan con Supabase directamente.
-- -----------------------------------------------------------------------------
alter table public.remote_devices       enable row level security;
alter table public.remote_pairing_codes enable row level security;
alter table public.remote_sessions      enable row level security;
alter table public.remote_audit         enable row level security;
alter table public.remote_auth_nonces   enable row level security;

revoke all on function public.luxy_expire_pairing_codes() from anon, authenticated;
revoke all on function public.luxy_purge_auth_nonces() from anon, authenticated;
