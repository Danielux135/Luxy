-- =============================================================================
-- Luxy - boveda privada
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
-- =============================================================================

-- -----------------------------------------------------------------------------
-- de quien es un registro
--
-- La unica identidad que existe hoy en Luxy es el token de maquina, y eso no
-- sirve para sincronizar: los registros de un portatil no serian visibles desde
-- el de sobremesa.
--
-- Por eso el propietario es el VAULT_ID: un identificador derivado de la llave
-- maestra con HKDF. Dos equipos que abren la misma boveda derivan el mismo
-- valor sin ponerse de acuerdo y sin que el servidor sepa nada de la llave,
-- porque HKDF no se invierte.
--
-- LIMITE IMPORTANTE, y esta escrito aqui para que no se olvide: el vault_id
-- AGRUPA, no AUTORIZA. Quien autoriza sigue siendo el token de maquina de 0001.
-- Una maquina con token valido podria pedir los registros de cualquier vault_id
-- que conozca; no podria descifrarlos, pero los tendria. Es aceptable mientras
-- valga D-001 (un solo usuario, sin multi-tenant). Si algun dia entra F9.10
-- (usuarios reales), esto tiene que revisarse ANTES de abrirlo a nadie mas.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- vault_records: los turnos de una conversacion privada, cifrados
-- -----------------------------------------------------------------------------
create table if not exists public.vault_records (
  record_id       uuid primary key,
  vault_id        text not null,
  conversation_id uuid not null,
  sequence        integer not null,
  -- sobre sellado {version, purpose, nonce, ciphertext}. El servidor valida su
  -- FORMA con Zod antes de aceptarlo, nunca su contenido.
  content         jsonb not null,
  -- memoria de la conversacion, sellada aparte y con otra subclave
  sealed_memory   jsonb,
  created_at      timestamptz not null default now(),

  constraint vault_records_vault_id_format
    check (vault_id ~ '^[A-Za-z0-9_-]{43}$'),
  constraint vault_records_sequence_positive check (sequence >= 0),
  -- mismo patron que job_events: reenviar un registro no lo duplica. Sin esto,
  -- un corte de red a mitad de una subida dejaria turnos repetidos.
  constraint vault_records_unique_sequence
    unique (vault_id, conversation_id, sequence)
);

create index if not exists vault_records_conversation_idx
  on public.vault_records (vault_id, conversation_id, sequence);

-- para sincronizar solo lo nuevo desde la ultima vez
create index if not exists vault_records_sync_idx
  on public.vault_records (vault_id, created_at desc);

-- -----------------------------------------------------------------------------
-- vault_media: imagenes y videos privados
--
-- los BYTES no viven aqui: van al almacen de objetos ya cifrados (F9.16). Esta
-- tabla solo dice donde estan y como abrirlos.
-- -----------------------------------------------------------------------------
create table if not exists public.vault_media (
  media_id              uuid primary key,
  vault_id              text not null,
  conversation_id       uuid not null,
  -- clave opaca en el almacen: 32 hex, sin nombre ni extension. Una clave
  -- derivada del contenido dejaria saber si dos archivos son iguales; una
  -- derivada del nombre lo revelaria directamente.
  object_key            text not null,
  byte_size             bigint not null,
  -- metadatos cifrados: tipo, nombre, prompt, dimensiones, duracion
  content               jsonb not null,
  thumbnail_object_key  text,
  created_at            timestamptz not null default now(),

  constraint vault_media_vault_id_format
    check (vault_id ~ '^[A-Za-z0-9_-]{43}$'),
  constraint vault_media_object_key_opaque check (object_key ~ '^[0-9a-f]{32}$'),
  constraint vault_media_thumbnail_opaque
    check (thumbnail_object_key is null or thumbnail_object_key ~ '^[0-9a-f]{32}$'),
  constraint vault_media_size_positive check (byte_size > 0),
  constraint vault_media_object_key_unique unique (vault_id, object_key)
);

create index if not exists vault_media_conversation_idx
  on public.vault_media (vault_id, conversation_id, created_at desc);

-- -----------------------------------------------------------------------------
-- vault_conversations: lo minimo para listar sin descargar los turnos
--
-- NO tiene titulo: el titulo va cifrado dentro de cada turno. Aqui solo esta lo
-- que el servidor necesita de verdad para responder "que hay" y "que ha
-- cambiado", y eso ya se asume como metadato visible.
-- -----------------------------------------------------------------------------
create table if not exists public.vault_conversations (
  conversation_id uuid primary key,
  vault_id        text not null,
  turn_count      integer not null default 0,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  constraint vault_conversations_vault_id_format
    check (vault_id ~ '^[A-Za-z0-9_-]{43}$'),
  constraint vault_conversations_turns_positive check (turn_count >= 0)
);

create index if not exists vault_conversations_sync_idx
  on public.vault_conversations (vault_id, updated_at desc);

-- borrar una conversacion se lleva sus turnos y sus medios: sin esto, borrarla
-- dejaria ciphertext huerfano ocupando espacio para siempre
alter table public.vault_records
  drop constraint if exists vault_records_conversation_fk;
alter table public.vault_records
  add constraint vault_records_conversation_fk
  foreign key (conversation_id) references public.vault_conversations (conversation_id)
  on delete cascade;

alter table public.vault_media
  drop constraint if exists vault_media_conversation_fk;
alter table public.vault_media
  add constraint vault_media_conversation_fk
  foreign key (conversation_id) references public.vault_conversations (conversation_id)
  on delete cascade;

-- -----------------------------------------------------------------------------
-- seguridad: mismas reglas que el resto del esquema
-- -----------------------------------------------------------------------------
alter table public.vault_records       enable row level security;
alter table public.vault_media         enable row level security;
alter table public.vault_conversations enable row level security;

-- force: ni siquiera el propietario de la tabla se salta RLS. Estas tres
-- guardan lo mas sensible del sistema, asi que van como machine_tokens.
alter table public.vault_records       force row level security;
alter table public.vault_media         force row level security;
alter table public.vault_conversations force row level security;

-- no se crea NINGUNA politica: sin politicas y con RLS activo, nadie que no sea
-- service_role ve una sola fila. El acceso pasa siempre por el gateway.
revoke all on public.vault_records       from anon, authenticated;
revoke all on public.vault_media         from anon, authenticated;
revoke all on public.vault_conversations from anon, authenticated;

grant select, insert, update, delete on table
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

revoke all on function public.luxy_touch_vault_conversation()
  from public, anon, authenticated;
grant execute on function public.luxy_touch_vault_conversation() to service_role;
