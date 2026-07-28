-- 0003: separa "familia de proveedor" de "modelo concreto".
--
-- MOTIVO. Hasta ahora provider era a la vez el proveedor, el modelo y el comando
-- de Telegram, y la restriccion jobs_provider_check fijaba cinco valores en la
-- base de datos. Con un catalogo de modelos configurable por el usuario esa
-- restriccion obliga a una migracion cada vez que se añade un modelo, lo cual no
-- es sostenible.
--
-- QUE CAMBIA:
--   1. jobs.provider pasa a admitir cualquier familia razonable, validada por
--      forma y no por lista cerrada. La lista de verdad vive en el catalogo del
--      agente, que es quien sabe que puede ejecutar.
--   2. se añade jobs.model, con el apiModel EXACTO que se uso. Es nullable
--      porque los trabajos antiguos no lo tienen y porque claude y codex usan
--      la sesion local sin modelo explicito.
--   3. provider_usage.model ya existia como texto libre; se le añade indice
--      para poder agregar consumo por modelo.
--
-- COMPATIBILIDAD: los cinco valores anteriores siguen siendo validos, asi que
-- los trabajos existentes no se tocan.

-- 1. restriccion de provider: forma, no lista cerrada -----------------------

alter table public.jobs
  drop constraint if exists jobs_provider_check;

alter table public.jobs
  add constraint jobs_provider_check
  check (provider ~ '^[a-z][a-z0-9_-]{0,31}$');

-- 2. modelo concreto usado en el trabajo ------------------------------------

alter table public.jobs
  add column if not exists model text;

alter table public.jobs
  drop constraint if exists jobs_model_check;

-- el apiModel se guarda TAL CUAL lo espera la API: se admiten mayusculas,
-- puntos y guiones (por ejemplo DeepSeek-V4-Pro o kat-coder-pro-v2.5)
alter table public.jobs
  add constraint jobs_model_check
  check (model is null or model ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');

create index if not exists jobs_model_idx
  on public.jobs (model, created_at desc)
  where model is not null;

-- 3. consumo por modelo ------------------------------------------------------

create index if not exists provider_usage_model_day_idx
  on public.provider_usage (model, created_at desc);

-- 4. la reclamacion sigue filtrando por familia ------------------------------
--
-- luxy_claim_job recibe p_providers con las familias que la maquina puede
-- ejecutar. No hace falta cambiar la funcion: el agente resuelve el modelo
-- concreto a partir de su catalogo local, y el gateway nunca decide por el.
--
-- El modelo elegido viaja en jobs.metadata.model y se copia a jobs.model al
-- completar el trabajo, para poder consultarlo sin abrir el JSON.
