# Plantilla: crear una migración

## Objetivo

Describe el cambio de esquema y **por qué** hace falta.

> Ejemplo: guardar la rama del worktree en una columna propia de `jobs`, para
> poder consultarla sin leer el JSON de `metadata`.

## Contexto necesario

- `supabase/CLAUDE.md` — reglas del esquema.
- `docs/SUPABASE.md` — modelo de datos.
- Las migraciones existentes en `supabase/migrations/`.

## Reglas innegociables

1. **Crea un archivo nuevo.** Nunca edites una migración ya aplicada: los
   entornos donde ya corrió quedarían divergentes sin forma de detectarlo.
2. Numeración correlativa: `000N_descripcion_corta.sql`.
3. **RLS activo** en cualquier tabla nueva.
4. **Sin permisos para `anon` ni `authenticated`**, salvo razón documentada en
   el propio SQL.
5. `create table if not exists` y `create or replace function`, para que
   reaplicar sea seguro.
6. **La reclamación debe seguir siendo atómica.**

## Plantilla

```sql
-- =============================================================================
-- Luxy - <descripcion>
-- Migracion acumulativa. NO modificar una vez aplicada.
-- =============================================================================

-- columnas nuevas: siempre "if not exists" y admitiendo nulos, para que la
-- migracion no falle con datos ya existentes
alter table public.jobs
  add column if not exists nueva_columna text;

create index if not exists jobs_nueva_columna_idx
  on public.jobs (nueva_columna)
  where nueva_columna is not null;

-- si creas una tabla, RLS y revocacion explicitas
-- alter table public.nueva enable row level security;
-- revoke all on public.nueva from anon, authenticated;
```

### Ampliar un enum

```sql
alter type luxy_job_status add value if not exists 'nuevo_estado';
```

> Postgres no permite quitar valores de un enum. Piénsalo antes.
> Y añade el mismo valor a `JOB_STATUSES` en `shared/constants.ts`: los dos
> deben coincidir.

## Cambios que NO puedes hacer sin autorización explícita

- `drop table`
- `drop column`
- `truncate`
- `delete from` sobre datos de trabajo
- cualquier cosa que pierda datos

Si el cambio los necesita, **para y pregunta**.

## Sincronizar con el código

| Cambio en SQL | Cambio en TypeScript |
|---|---|
| Valor nuevo en `luxy_job_status` | `JOB_STATUSES` + `STATUS_LABELS` |
| Proveedor nuevo en `jobs_provider_check` | `PROVIDER_IDS` + `PROVIDER_LABELS` |
| Tipo nuevo en `job_events_type_check` | `JOB_EVENT_TYPES` |
| Columna nueva en `jobs` | `JobRow` y `toJob()` en `gateway/repository.ts` |

## Pruebas requeridas

`packages/shared/src/migrations.test.ts` valida estructuralmente. Si tu
migración añade una tabla, un índice o una función, **añade su comprobación**
a ese archivo.

```powershell
npm test
```

## Aplicar la migración

**No la apliques tú.** El usuario decide cuándo y dónde.

Instrucciones para el usuario:

1. Aplicarla primero en un **proyecto de Supabase de pruebas**.
2. SQL Editor → New query → pegar el contenido → Run.
3. Verificar:

```sql
select table_name from information_schema.tables where table_schema = 'public';
select routine_name from information_schema.routines where routine_name like 'luxy%';
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

4. Solo entonces, aplicarla en el proyecto real.

## Formato del informe final

```
Migración creada:
  supabase/migrations/000N_<nombre>.sql

Qué cambia:
  <tablas, columnas, funciones, índices>

Sincronización con el código:
  <qué constantes o tipos se han actualizado>

Comprobaciones estructurales:
  npm test → migrations.test.ts: N pruebas, resultado real

NO ejecutada contra Postgres:
  Esta migración no se ha aplicado a ninguna base de datos.
  El usuario debe probarla primero en un proyecto de pruebas.

Riesgos:
  <bloqueos, datos existentes, irreversibilidad de los enums>
```
