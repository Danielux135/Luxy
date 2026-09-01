-- =============================================================================
-- Luxy - boveda privada con cuentas
--
-- Migracion acumulativa. NO modifica 0001-0006.
-- El enum luxy_job_status NO se toca: un registro de boveda no es un trabajo y
-- no pasa por la cola.
--
-- ESTADO: preparada, NO aplicada automaticamente.
--
-- Lo que este esquema guarda es TEXTO CIFRADO. El servidor no puede leerlo, y
-- no existe ninguna columna donde quepa contenido en claro: no hay title, ni
-- prompt, ni mime_type, ni output_url. No es que se prometa no guardarlos; es
-- que no hay donde ponerlos.
--
-- Ver D-045 (varias personas con cuenta propia) y D-046 (la contraseña
-- autentica y cifra por caminos separados).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vault_users: una persona con su parte privada
--
-- Aqui esta la pieza que hace que esto funcione sin romper el cifrado.
--
-- El servidor guarda `auth_hash`: una SEGUNDA vuelta de Argon2id sobre la llave
-- maestra, usando la contraseña como sal. Sirve para verificar quien eres y no
-- sirve para nada mas. Recuperar la llave maestra desde ese hash exigiria
-- invertir Argon2id.
--
-- Y guarda `wrapped_master_key`: la llave maestra CIFRADA con la contraseña.
-- El servidor la transporta y no puede abrirla. Es lo que permite entrar desde
-- un equipo nuevo sabiendo solo la contraseña.
--
-- Consecuencia que se asume: el servidor NO puede restablecer una contraseña.
-- Puede borrar una cuenta, nunca recuperar su contenido. La clave de
-- recuperacion es la unica red de seguridad real.
-- -----------------------------------------------------------------------------
create table if not exists public.vault_users (
  id                  uuid primary key default gen_random_uuid(),
  -- siempre en minusculas: dos cuentas que solo difieran en mayusculas serian
  -- la misma persona equivocandose, no dos personas
  email               text not null,
  -- sal de la PRIMERA derivacion, la que produce la llave maestra. El cliente
  -- la necesita antes de poder iniciar sesion, asi que es publica por diseño.
  auth_salt           text not null,
  -- coste de Argon2id con el que se creo esta cuenta. Se guarda para que subir
  -- el coste por defecto no deje fuera a quien se registro antes.
  argon2_t            integer not null,
  argon2_m            integer not null,
  argon2_p            integer not null,
  -- segunda vuelta de Argon2id. Es lo unico derivado de la contraseña que el
  -- servidor llega a ver.
  auth_hash           text not null,
  -- llave maestra cifrada con la contraseña; el servidor no puede abrirla
  wrapped_master_key  jsonb not null,
  -- identificador de boveda que el cliente deriva por su cuenta. Se guarda para
  -- que el cliente pueda comprobar, tras entrar, que el servidor le ha dado la
  -- cuenta correcta y no otra.
  vault_id            text not null,
  disabled            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint vault_users_email_lowercase check (email = lower(email)),
  constraint vault_users_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint vault_users_email_unique unique (email),
  constraint vault_users_vault_id_format check (vault_id ~ '^[A-Za-z0-9_-]{43}$'),
  constraint vault_users_vault_id_unique unique (vault_id),
  constraint vault_users_auth_hash_format check (auth_hash ~ '^[A-Za-z0-9_-]{43}$'),
  constraint vault_users_salt_format check (auth_salt ~ '^[A-Za-z0-9_-]{22}$'),
  -- mismos limites que valida el cliente: un coste manipulado no puede pedir
  -- memoria absurda ni rebajarse hasta volverse inutil
  constraint vault_users_argon2_sane check (
    argon2_t between 1 and 16
    and argon2_m between 8192 and 2097152
    and argon2_p between 1 and 4
  )
);

drop trigger if exists vault_users_touch on public.vault_users;
create trigger vault_users_touch
  before update on public.vault_users
  for each row execute function luxy_touch_updated_at();

-- -----------------------------------------------------------------------------
-- vault_sessions: sesiones iniciadas
--
-- Solo el HASH del token, nunca el token. Mismo criterio que machine_tokens en
-- 0001: quien se lleve esta tabla no obtiene credenciales utilizables.
-- -----------------------------------------------------------------------------
create table if not exists public.vault_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.vault_users (id) on delete cascade,
  token_hash  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  -- para que la persona pueda ver desde donde hay sesiones abiertas
  machine_id  uuid references public.machines (id) on delete set null,

  constraint vault_sessions_token_hash_unique unique (token_hash)
);

create index if not exists vault_sessions_user_idx
  on public.vault_sessions (user_id, expires_at desc);

create index if not exists vault_sessions_live_idx
  on public.vault_sessions (token_hash) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- vault_conversations
--
-- NO tiene titulo: el titulo va cifrado dentro de cada turno. Aqui solo esta lo
-- que el servidor necesita para responder "que hay" y "que ha cambiado".
--
-- El propietario es `owner_user_id`, no el vault_id. Esa es la correccion que
-- exigio D-045: con varias personas, agrupar no basta, hay que autorizar.
-- -----------------------------------------------------------------------------
create table if not exists public.vault_conversations (
  conversation_id uuid primary key,
  owner_user_id   uuid not null references public.vault_users (id) on delete cascade,
  turn_count      integer not null default 0,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  constraint vault_conversations_turns_positive check (turn_count >= 0)
);

create index if not exists vault_conversations_sync_idx
  on public.vault_conversations (owner_user_id, updated_at desc);

-- -----------------------------------------------------------------------------
-- vault_records: los turnos de una conversacion privada, cifrados
-- -----------------------------------------------------------------------------
create table if not exists public.vault_records (
  record_id       uuid primary key,
  owner_user_id   uuid not null references public.vault_users (id) on delete cascade,
  conversation_id uuid not null references public.vault_conversations (conversation_id) on delete cascade,
  sequence        integer not null,
  -- sobre sellado {version, purpose, nonce, ciphertext}. El servidor valida su
  -- FORMA con Zod antes de aceptarlo, nunca su contenido.
  content         jsonb not null,
  -- memoria de la conversacion, sellada aparte y con otra subclave
  sealed_memory   jsonb,
  created_at      timestamptz not null default now(),

  constraint vault_records_sequence_positive check (sequence >= 0),
  -- mismo patron que job_events: reenviar un registro no lo duplica. Sin esto,
  -- un corte de red a mitad de una subida dejaria turnos repetidos.
  constraint vault_records_unique_sequence
    unique (conversation_id, sequence)
);

create index if not exists vault_records_conversation_idx
  on public.vault_records (conversation_id, sequence);

create index if not exists vault_records_sync_idx
  on public.vault_records (owner_user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- vault_media: imagenes y videos privados
--
-- los BYTES no viven aqui: van al almacen de objetos ya cifrados. Esta tabla
-- solo dice donde estan y como abrirlos.
-- -----------------------------------------------------------------------------
create table if not exists public.vault_media (
  media_id              uuid primary key,
  owner_user_id         uuid not null references public.vault_users (id) on delete cascade,
  conversation_id       uuid not null references public.vault_conversations (conversation_id) on delete cascade,
  -- clave opaca en el almacen: 32 hex, sin nombre ni extension. Una clave
  -- derivada del contenido dejaria saber si dos archivos son iguales; una
  -- derivada del nombre lo revelaria directamente.
  object_key            text not null,
  byte_size             bigint not null,
  -- metadatos cifrados: tipo, nombre, prompt, dimensiones, duracion
  content               jsonb not null,
  thumbnail_object_key  text,
  created_at            timestamptz not null default now(),

  constraint vault_media_object_key_opaque check (object_key ~ '^[0-9a-f]{32}$'),
  constraint vault_media_thumbnail_opaque
    check (thumbnail_object_key is null or thumbnail_object_key ~ '^[0-9a-f]{32}$'),
  constraint vault_media_size_positive check (byte_size > 0),
  -- unica por propietario y no globalmente: dos personas no deben poder
  -- descubrir que comparten un archivo por un choque de claves
  constraint vault_media_object_key_unique unique (owner_user_id, object_key)
);

create index if not exists vault_media_conversation_idx
  on public.vault_media (conversation_id, created_at desc);

-- -----------------------------------------------------------------------------
-- seguridad: mismas reglas que el resto del esquema
-- -----------------------------------------------------------------------------
alter table public.vault_users         enable row level security;
alter table public.vault_sessions      enable row level security;
alter table public.vault_records       enable row level security;
alter table public.vault_media         enable row level security;
alter table public.vault_conversations enable row level security;

-- force: ni siquiera el propietario de la tabla se salta RLS. Estas guardan lo
-- mas sensible del sistema, asi que van como machine_tokens.
alter table public.vault_users         force row level security;
alter table public.vault_sessions      force row level security;
alter table public.vault_records       force row level security;
alter table public.vault_media         force row level security;
alter table public.vault_conversations force row level security;

-- no se crea NINGUNA politica: sin politicas y con RLS activo, nadie que no sea
-- service_role ve una sola fila. El acceso pasa siempre por el gateway, que es
-- quien comprueba a que usuario pertenece cada peticion.
revoke all on public.vault_users         from anon, authenticated;
revoke all on public.vault_sessions      from anon, authenticated;
revoke all on public.vault_records       from anon, authenticated;
revoke all on public.vault_media         from anon, authenticated;
revoke all on public.vault_conversations from anon, authenticated;

grant select, insert, update, delete on table
  public.vault_users,
  public.vault_sessions,
  public.vault_records,
  public.vault_media,
  public.vault_conversations
to service_role;

-- -----------------------------------------------------------------------------
-- luxy_touch_vault_conversation: mantiene el recuento y la fecha
--
-- lo hace un trigger y no el gateway porque el recuento tiene que cuadrar
-- aunque una subida se reintente o llegue desordenada.
-- -----------------------------------------------------------------------------
create or replace function public.luxy_touch_vault_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation uuid;
begin
  -- en un DELETE `new` es nulo y en un INSERT lo es `old`: hay que mirar el
  -- que corresponda o el trigger falla justo al borrar
  if tg_op = 'DELETE' then
    v_conversation := old.conversation_id;
  else
    v_conversation := new.conversation_id;
  end if;

  update public.vault_conversations c
     set turn_count = (
           select count(*) from public.vault_records r
            where r.conversation_id = v_conversation
         ),
         updated_at = now()
   where c.conversation_id = v_conversation;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists vault_records_touch on public.vault_records;
create trigger vault_records_touch
  after insert or delete on public.vault_records
  for each row execute function public.luxy_touch_vault_conversation();

-- -----------------------------------------------------------------------------
-- luxy_expire_vault_sessions: limpia sesiones caducadas
--
-- se llama desde el cron que ya existe para luxy_expire_leases. Una sesion
-- caducada que sigue en la tabla no da acceso, pero acumular millones de filas
-- muertas acaba costando.
-- -----------------------------------------------------------------------------
create or replace function public.luxy_expire_vault_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.vault_sessions
   where expires_at < now() - interval '7 days'
      or (revoked_at is not null and revoked_at < now() - interval '7 days');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.luxy_touch_vault_conversation()
  from public, anon, authenticated;
revoke all on function public.luxy_expire_vault_sessions()
  from public, anon, authenticated;

grant execute on function public.luxy_touch_vault_conversation() to service_role;
grant execute on function public.luxy_expire_vault_sessions() to service_role;
