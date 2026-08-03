# Configuración de Supabase

Supabase es el estado compartido de Luxy: la cola de trabajos, los leases, los
eventos de progreso y la auditoría de aprobaciones.

## 1. Crear el proyecto

1. Entra en [supabase.com](https://supabase.com) y crea un proyecto.
2. El plan gratuito sobra para un uso personal.
3. Elige una región cercana: reduce la latencia del polling.

## 2. Aplicar las migraciones

**SQL Editor → New query**, y ejecuta **en este orden**:

1. `supabase/migrations/0001_luxy_initial_schema.sql`
2. `supabase/migrations/0002_luxy_job_claim.sql`
3. `supabase/migrations/0003_luxy_model_registry.sql`
4. `supabase/migrations/0005_luxy_studio_jobs.sql`

`0004_luxy_remote.sql` es independiente y pertenece a Luxy Remote, actualmente
pausado. No hace falta aplicarla para Studio. La aplicación nunca ejecuta estas
migraciones automáticamente.

> **Antes de aplicarlas a tu proyecto real, pruébalas en uno de pruebas.**
> No se han ejecutado contra un Postgres real durante el desarrollo (ver
> "Limitación conocida" abajo).

Comprueba que quedó todo:

```sql
select table_name
  from information_schema.tables
 where table_schema = 'public'
 order by table_name;
```

Esperado: `approvals`, `job_events`, `jobs`, `machine_tokens`, `machines`,
`provider_usage`, `telegram_updates`, `telegram_users`.

Comprueba las funciones:

```sql
select routine_name
  from information_schema.routines
 where routine_schema = 'public' and routine_name like 'luxy%';
```

Esperado: `luxy_claim_job`, `luxy_renew_lease`, `luxy_expire_leases`,
`luxy_request_cancel`.

Comprueba que RLS está activo:

```sql
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public';
```

Todas deben tener `rowsecurity = true`.

## 3. Obtener las credenciales

**Settings → API**:

| Campo          | Variable                    | Dónde va                            |
| -------------- | --------------------------- | ----------------------------------- |
| Project URL    | `SUPABASE_URL`              | secret de Cloudflare                |
| `service_role` | `SUPABASE_SERVICE_ROLE_KEY` | secret de Cloudflare **y solo ahí** |

> La `service_role` omite RLS por completo. **Nunca** debe estar en tus
> ordenadores, ni en el repositorio, ni en `config.json`. El agente local no la
> necesita: habla con el gateway, no con Supabase.

La clave `anon` no se usa en absoluto: las migraciones le revocan todo permiso.

## 4. Modelo de datos

### telegram_updates

Idempotencia. `update_id` es clave primaria, así que un reenvío de Telegram no
puede lanzar el mismo trabajo dos veces.

### telegram_users

Lista blanca y **máquina preferida** de cada usuario.

### machines

Una fila por instalación de Luxy. `name` es único y es como te refieres a ella
(`/use casa`). `capabilities` guarda qué herramientas hay instaladas de verdad;
`projects` los alias configurados.

### machine_tokens

**Solo el hash SHA-256.** No hay ninguna columna con el token en claro. Soporta
caducidad (`expires_at`) y revocación (`revoked_at`). Registrar de nuevo una
máquina revoca sus tokens anteriores.

### jobs

La cola. `created_via` distingue `telegram`, `studio` y `mobile`; los ids de
Telegram son nulos para Studio/Mobile y siguen siendo obligatorios para trabajos
de Telegram. Estados:

```
queued → claimed → running → completed
                           → failed
                           → cancelled
                           → interrupted
waiting_for_machine   (esperando que elijas máquina)
waiting_for_approval  (esperando commit/descarte/push)
```

### job_events

Progreso incremental. `unique (job_id, sequence)` hace idempotente el reenvío
desde la cola local del agente.

### approvals

Auditoría. Cada commit, descarte o push queda registrado con quién lo aprobó y
cuándo.

### provider_usage

Tokens y coste estimado de las APIs HTTP.

## 5. La reclamación atómica

Es la pieza clave para que **dos máquinas nunca ejecuten el mismo trabajo**:

```sql
select j.id into v_job_id
  from public.jobs j
 where ...
 order by j.priority desc, j.created_at asc
 limit 1
   for update skip locked;
```

`FOR UPDATE SKIP LOCKED` hace que, si dos máquinas llaman a la vez, la segunda
**salte** la fila bloqueada por la primera en lugar de esperar. La exclusión la
garantiza Postgres, no el código de la aplicación.

La función también:

- ignora máquinas deshabilitadas,
- respeta `target_machine_id` cuando está fijado,
- exige que la máquina tenga el proyecto y sepa ejecutar el proveedor,
- ignora trabajos con cancelación solicitada,
- **solo** recupera leases caducados si `started_at is null`.

Esa última condición es deliberada: si el trabajo ya empezó, pudo dejar cambios
sin guardar en el worktree de esa máquina, así que **no se reasigna solo**.

## 6. Barrido de leases

`luxy_expire_leases()` la llama el cron del Worker cada minuto:

- `claimed` + `started_at is null` + lease caducado → vuelve a `queued`.
- Ya empezado + lease caducado → `interrupted`, y **se conservan los cambios**.

Puedes ejecutarla a mano:

```sql
select * from public.luxy_expire_leases();
```

## 7. Consultas útiles

```sql
-- trabajos activos
select short_id, status, provider, project_alias, created_at
  from jobs
 where status not in ('completed','failed','cancelled','interrupted')
 order by created_at desc;

-- maquinas y su ultimo contacto
select name, enabled, last_seen_at, now() - last_seen_at as hace
  from machines order by name;

-- consumo de APIs de los ultimos 7 dias
select provider, sum(input_tokens) as entrada, sum(output_tokens) as salida,
       round(sum(estimated_cost), 4) as coste
  from provider_usage
 where created_at > now() - interval '7 days'
 group by provider;

-- auditoria de aprobaciones
select a.action, a.status, a.resolved_at, j.short_id
  from approvals a join jobs j on j.id = a.job_id
 order by a.requested_at desc limit 20;
```

## 8. Mantenimiento

Los updates y eventos antiguos se pueden podar sin riesgo:

```sql
delete from telegram_updates where received_at < now() - interval '30 days';

delete from job_events
 where job_id in (
   select id from jobs
    where completed_at < now() - interval '30 days'
 );
```

**No borres** `jobs` con worktrees vivos: perderías la referencia a cambios sin
guardar.

## 9. Crear una migración nueva

1. Crea `supabase/migrations/000N_descripcion.sql` con el siguiente número.
2. **Nunca modifiques una migración ya aplicada.** Son acumulativas.
3. Mantén RLS activo y no concedas permisos a `anon` ni `authenticated`.
4. Ejecuta `npm test`: `migrations.test.ts` comprueba estas invariantes.
5. Pruébala en un proyecto de pruebas antes que en el real.

## Verificación

`0001`, `0002` y `0003` se han contrastado en el Supabase personal conectado.
`0005` todavía requiere probarse primero en un proyecto de pruebas antes de
aplicarla al real. La suite estructural (`packages/shared/src/migrations.test.ts`)
verifica:

- delimitadores `$$` y paréntesis equilibrados,
- que existan todas las tablas, índices y funciones,
- que RLS esté activo en todas las tablas,
- que `anon` y `authenticated` no tengan permisos,
- que el token solo se guarde como hash,
- que la reclamación use `FOR UPDATE SKIP LOCKED` y `limit 1`,
- que solo recupere leases con `started_at is null`,
- que no haya ningún secreto real en el SQL.

Aun así, **ejecútalas primero en un proyecto de Supabase de pruebas**.
