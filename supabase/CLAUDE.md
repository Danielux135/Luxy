# supabase — reglas específicas

Migraciones SQL de Luxy. Aquí vive el estado compartido entre máquinas.

## Reglas innegociables

1. **Las migraciones son acumulativas.** Se aplican por orden de número.
2. **No modifiques una migración ya aplicada.** Crea una nueva con el siguiente
   número. Si la editas, los entornos donde ya se aplicó quedan divergentes y no
   hay forma de detectarlo.
3. **RLS debe permanecer activo** en todas las tablas.
4. **No concedas permisos a `anon` ni a `authenticated`** sin una razón
   documentada en el propio SQL. Hoy no hay ninguna: el único cliente es el
   Worker con `service_role`, que omite RLS.
5. **La reclamación de trabajos debe seguir siendo atómica.**

## Convenciones

- Nombre: `000N_descripcion_corta.sql`, número de 4 dígitos.
- `create table if not exists` y `create or replace function`, para que
  reaplicar sea seguro.
- Funciones con `security definer` y `set search_path = public`.
- Comentarios en español explicando **por qué**, sobre todo en las condiciones
  de la reclamación.

## La reclamación atómica

`luxy_claim_job` es la pieza crítica. Garantiza que **dos máquinas nunca
ejecutan el mismo trabajo**:

```sql
select j.id into v_job_id
  from public.jobs j
 where ...
 order by j.priority desc, j.created_at asc
 limit 1
   for update skip locked;
```

`FOR UPDATE SKIP LOCKED` hace que la segunda máquina **salte** la fila bloqueada
en lugar de esperarla. La exclusión la da Postgres, no el código.

Si la modificas, mantén todas estas condiciones:

- `limit 1` — como máximo un trabajo por llamada.
- `cancel_requested_at is null` — ignora los cancelados.
- `m.enabled` — ignora las máquinas deshabilitadas.
- `target_machine_id is null or = p_machine_id` — respeta la máquina objetivo.
- `provider = any(p_providers)` y `project_alias = any(p_projects)`.
- Para recuperar un lease caducado: **`started_at is null`**.

## La condición `started_at is null`

Es la regla más importante del esquema.

Un trabajo con lease caducado solo se devuelve a la cola si **nunca empezó a
ejecutarse**. Si ya había empezado, pudo dejar cambios sin guardar en el
worktree de esa máquina; reasignarlo a otra los perdería o los duplicaría.

Esos trabajos pasan a `interrupted` en `luxy_expire_leases` y **esperan una
decisión del usuario**. No los "arregles" haciendo que se reasignen solos.

## Los tokens nunca en claro

`machine_tokens` guarda **solo** `token_hash` (SHA-256). No añadas ninguna
columna que guarde el token. El valor en claro se entrega una única vez al
registrar la máquina.

Hay una prueba que falla si aparece una columna `token text`.

## Cancelar no borra

`luxy_request_cancel` solo marca `cancel_requested_at`. **No borra nada.** Los
cambios del worktree se conservan siempre y es el usuario quien decide.

Ninguna migración debe contener `delete from` sobre datos de trabajo.

## Crear una migración

```sql
-- supabase/migrations/0003_descripcion.sql
-- Migracion acumulativa. NO modificar una vez aplicada.

alter table public.jobs add column if not exists nueva_columna text;

-- si la tabla es nueva, RLS explicito:
-- alter table public.nueva enable row level security;
-- revoke all on public.nueva from anon, authenticated;
```

Después:

```powershell
npm test    # migrations.test.ts valida las invariantes
```

## Validación

`packages/shared/src/migrations.test.ts` comprueba sin base de datos:

- `$$` y paréntesis equilibrados,
- que existan todas las tablas, índices y funciones,
- RLS activo en todas las tablas,
- sin permisos para `anon` ni `authenticated`,
- token solo como hash,
- `FOR UPDATE SKIP LOCKED` y `limit 1` en la reclamación,
- `started_at is null` en la recuperación de leases,
- que no haya ningún secreto real en el SQL.

**Limitación:** estas migraciones **no se han ejecutado contra un PostgreSQL
real**. La validación es estructural. **Aplícalas primero en un proyecto de
Supabase de pruebas**, nunca directamente en el real.

## Nunca

- Aplicar migraciones contra producción sin que el usuario lo pida.
- `drop table` o `drop column` sin autorización explícita.
- Poner un secreto real en un archivo `.sql`.
