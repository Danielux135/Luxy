# Configuración de Cloudflare

El Worker es la **única** pieza pública de Luxy. Recibe los webhooks de Telegram
y expone la API privada que consultan tus ordenadores.

## 1. Preparar

```powershell
cd apps\gateway
Copy-Item wrangler.toml.example wrangler.toml
npx wrangler login
```

`wrangler.toml` está en `.gitignore`. **Nunca escribas secretos dentro.**

Ajusta en `wrangler.toml`:

```toml
name = "luxy-gateway"        # cambialo si ese nombre esta cogido

[vars]
TELEGRAM_BOT_USERNAME = "LuxyBot"   # el username real de tu bot
MACHINE_OFFLINE_SECONDS = "45"
JOB_LEASE_SECONDS = "120"
RATE_LIMIT_PER_MINUTE = "30"
LOG_LEVEL = "info"
# VAULT_OBJECT_MAX_BYTES = "50000000"   # opcional: tope de un archivo de la bóveda
```

`VAULT_OBJECT_MAX_BYTES` es el tope de un archivo cifrado de la bóveda en
Supabase Storage. Sin ella vale 50.000.000 bytes, por debajo de los 50 MB por
archivo del plan gratuito; nunca pasa de 90 MiB, el cuerpo de una petición a un
Worker. `capabilities` lo anuncia y Studio salta sin subirlo lo que no cabe.
Súbela solo si el plan y el límite del bucket admiten más.

## 2. Cargar los secretos

Uno a uno. Wrangler los pide por consola y no quedan en ningún archivo:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_ADMIN_USER_ID
npx wrangler secret put TELEGRAM_ALLOWED_CHAT_IDS
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put MACHINE_REGISTRATION_SECRET
```

Comprobar cuáles hay cargados (muestra los nombres, no los valores):

```powershell
npx wrangler secret list
```

### Qué es cada uno

| Secret | De dónde sale |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | lo generas tú |
| `TELEGRAM_ADMIN_USER_ID` | @userinfobot |
| `TELEGRAM_ALLOWED_CHAT_IDS` | ids separados por coma |
| `SUPABASE_URL` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `MACHINE_REGISTRATION_SECRET` | lo generas tú, y lo rotas tras dar de alta las máquinas |

Generar los que inventas tú:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

> **`SUPABASE_SERVICE_ROLE_KEY` solo existe aquí.** Nunca en tus ordenadores.

## 3. Comprobar el empaquetado antes de desplegar

```powershell
npm run dry-run
```

Compila y empaqueta sin subir nada. Debe terminar con `Total Upload: ...`.

## 4. Desplegar

```powershell
npx wrangler deploy
```

Te devuelve la URL:

```
https://luxy-gateway.TU-CUENTA.workers.dev
```

Esa es la que pide `npm run setup:machine`.

## 5. Comprobar

```powershell
Invoke-RestMethod "https://luxy-gateway.TU-CUENTA.workers.dev/health"
```

Esperado:

```json
{ "service": "luxy-gateway", "status": "ok", "configured": true, "time": "..." }
```

`configured: false` significa que faltan secretos.

## 6. Registrar el webhook de Telegram

Ver [TELEGRAM.md](TELEGRAM.md#5-registrar-el-webhook).

## 7. Endpoints

### Público

| Método | Ruta | Auth |
|---|---|---|
| `GET` | `/health` | ninguna |
| `POST` | `/telegram/webhook` | secret token de Telegram |

### Privado (token de máquina)

| Método | Ruta |
|---|---|
| `POST` | `/api/machines/register` (usa el secreto de registro) |
| `POST` | `/api/machines/heartbeat` |
| `POST` | `/api/jobs/claim` |
| `GET` | `/api/jobs/:jobId/control` |
| `POST` | `/api/jobs/:jobId/events` |
| `POST` | `/api/jobs/:jobId/complete` |
| `POST` | `/api/jobs/:jobId/fail` |
| `POST` | `/api/jobs/:jobId/cancelled` |
| `POST` | `/api/approvals/:approvalId/resolve` |
| `POST` | `/api/approvals/:approvalId/complete` |
| `POST` | `/api/studio/jobs/:jobId/action` |
| `POST` | `/api/studio/jobs/:jobId/feedback` |

Todos los privados exigen `Authorization: Bearer <token de máquina>`, y una
máquina **solo** puede tocar sus propios trabajos.

`/api/studio/jobs/:jobId/action` registra `commit` o `discard` tras la
confirmación de Studio. La máquina propietaria lo recoge por
`/api/approvals/pending` y cierra la orden con `/complete`. Las aprobaciones
consumidas pasan a `expired`, de modo que conservan auditoría sin volver a
ejecutarse.

`/api/studio/jobs/:jobId/feedback` acepta `helpful` o `not_helpful` solo para
respuestas completadas creadas por ese mismo Studio. La valoracion queda en la
metadata del trabajo y alimenta la recomendacion visible de modelos.

### Bóveda (sesión de cuenta)

Las cuentas (`/api/vault/register`, `/api/vault/login/start`,
`/api/vault/login/finish`, `/api/vault/logout`, `/api/vault/password`) y los
bytes de los medios (`PUT` y `GET /api/vault/media/objects/:objectKey`) siguen
como estaban. La descarga de un objeto se autoriza en `vault_media` por la
clave del original **o** por la de su miniatura. La subida de bytes responde
**413** si el objeto pasa de `VAULT_OBJECT_MAX_BYTES` (lo mira antes de leer,
por `Content-Length`) **o** si Storage lo rechaza por tamaño, en cualquiera de
sus dos formas (413, o 400 con `statusCode: "413"`): «demasiado grande» no es
un fallo pasajero, y con un 502 Studio lo reintentaba entero en cada pasada.

**Sincronización v2 (`D-110`).** El contrato exacto —cuerpos, respuestas,
topes— está en `packages/shared/src/vault-sync-v2.ts` y lo comparten el gateway
y Studio. Todas exigen `Authorization: Bearer <sesión de la cuenta>` (sin ella,
401) y filtran por el usuario de esa sesión. **Los ids van en el cuerpo, nunca
en la URL**, para que no queden en registros de acceso.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `GET` | `/api/vault/v2/capabilities` | — | `{protocol: 2, facts, limits, sessionExpiresAt}`; `limits.objectMaxBytes` es `VAULT_OBJECT_MAX_BYTES` |
| `POST` | `/api/vault/v2/conversations/list` | `{after, limit ≤ 500}` | `[{conversationId, turnCount, updatedAt}]` |
| `POST` | `/api/vault/v2/conversations/manifest` | `{conversationId, after, limit ≤ 1000}` | `[{sequence, recordId}]` |
| `POST` | `/api/vault/v2/records/fetch` | `{conversationId, sequences ≤ 100}` | `[registro]` |
| `POST` | `/api/vault/v2/records/push` | `{conversationId, base, records ≤ 40}` | 200 `{results}` / 409 `{reason}` |
| `POST` | `/api/vault/v2/media/list` | `{after, limit ≤ 500}` | `[medio]` |
| `POST` | `/api/vault/v2/media/push` | `{media}` | 200 `{outcome}` / 409 `{reason}` |
| `POST` | `/api/vault/v2/conversations/purge` | `{conversationId, after}` | `{done, after, deletedObjects}` |

Lo que el servidor hace cumplir:

- **Lecturas sin analizar.** Las listas, el manifiesto y los registros son el
  cuerpo de PostgREST tal cual, con alias de columnas. Las fechas llegan como
  las escribe Postgres (`+00:00`) y el cliente las normaliza; las páginas van
  ordenadas por id o secuencia. PostgREST recorta cualquier lectura a su «Max
  rows» (1000 por defecto en Supabase) **sin avisar**, así que ningún tope de
  página pasa de 1000 (`VAULT_POSTGREST_MAX_ROWS`) y el cliente pide páginas
  hasta recibir una **vacía**: una corta no prueba que no haya más.
- **Topes por bytes antes de leer.** `Content-Length` primero y, si falta o
  miente, se cuenta al leer: un lote de turnos hasta 512 KiB, un registro solo
  hasta 4 MiB, el alta de un medio hasta 1 MiB y las demás peticiones hasta
  16 KiB. Si se pasa, **413**. Un límite de página por encima del máximo es un
  **422**, no se recorta.
- **Subida de turnos atómica.** `base` es el último turno del servidor anterior
  al lote. El orden: dueño (otra cuenta, **404**), espacio de hechos (**409**
  `space`), base (**409** `base-mismatch`) e `INSERT` plano. Si choca, no entra
  nada y responde **409** `records` con cada registro clasificado en
  `duplicate`, `conflict` o `pending`. Una conversación que no existe solo se
  crea con `base: null`; con base, **409** `conversation-missing`.
- **Rango reservado.** Los turnos van por debajo de `VAULT_FACT_SEQUENCE_BASE`
  (1.000.000.000); lo de arriba es de los hechos de F2 y ninguna ruta de turnos
  lo acepta ni lo devuelve.
- **Alta de medios.** La conversación tiene que existir y ser del usuario (no
  la crea), no ser un espacio, y los bytes del original y de la miniatura tienen
  que estar ya subidos: se comprueba sin descargarlos. Responde `stored` o
  `duplicate`; si no, **409** con `object-missing`, `conversation-missing`,
  `space` o `conflict`.
- **Purga por tandas.** Cada llamada borra los objetos de 20 medios como mucho
  (≤ 40 objetos, ≤ 48 subpeticiones contando la autenticación) y devuelve el
  cursor; la última borra la conversación y, en cascada, sus turnos y medios.
  Es reanudable e idempotente. La usará F2.
- **Fallos.** Un error de Supabase o del almacén es un **502** redactado; su
  cuerpo no sale ni se registra.
- **Sesión.** Si a la sesión le quedan menos de 15 días, usarla la alarga a
  30. `capabilities` devuelve la caducidad ya renovada.

**v1 cerrada.** `POST /api/vault/records`, `GET /api/vault/conversations`,
`GET /api/vault/conversations/:id`, `GET` y `POST /api/vault/media` y
`POST /api/vault/conversations/:id/delete` responden **426** «actualiza Luxy
Studio» **antes de autenticar** y sin tocar la base. La v1 nunca funcionó
(`SEG-SYNC-001`), y así ningún Studio viejo puede escribir ni resucitar lo
borrado.

## 8. Cron de leases

`wrangler.toml` incluye:

```toml
[triggers]
crons = ["*/1 * * * *"]
```

Cada minuto ejecuta `luxy_expire_leases()`, que detecta máquinas que dejaron de
responder. Sin este cron, un trabajo cuya máquina se apagó se quedaría colgado.

Probarlo en local:

```powershell
npx wrangler dev --test-scheduled
# en otra terminal:
Invoke-RestMethod "http://localhost:8787/__scheduled"
```

## 9. Desarrollo local

```powershell
Copy-Item ..\..\.env.example .dev.vars
notepad .dev.vars
npx wrangler dev
```

`.dev.vars` está en `.gitignore`.

## 10. Logs

```powershell
npx wrangler tail
npx wrangler tail --format pretty
```

Son JSON de una línea por evento. **Los secretos salen ya redactados**: el
Worker registra sus propios secretos al arrancar y `redact()` los elimina de
cualquier log o mensaje antes de que salgan.

Los de la bóveda llevan **solo el `userId` y recuentos** (recibidos,
guardados, duplicados, conflictos, objetos borrados) y, si algo falla, el
estado y el código de Supabase. Nunca un id de conversación, de turno, de medio
ni una clave de objeto, ni el cuerpo de un error de Supabase: el detalle de un
`23505` o un `23503` incluye la clave que chocó. Las pruebas del gateway lo
comprueban en cada línea.

## 11. Rate limiting

`RATE_LIMIT_PER_MINUTE` (30 por defecto) limita las peticiones por usuario. Las
máquinas tienen su propio límite de 240/min, holgado para un polling de 2 s.

**Limitación conocida:** el contador vive en memoria del isolate. Cloudflare
puede tener varios a la vez, así que el límite es **por isolate** y por tanto
aproximado. Frena bucles y abuso accidental. Para un límite exacto y global
habría que pasarlo a un Durable Object.

## 12. Problemas

**`wrangler deploy` falla con "name already taken"**
Cambia `name` en `wrangler.toml`.

**`/health` devuelve `configured: false`**
`npx wrangler secret list` y carga los que falten.

**El webhook devuelve 401**
El `TELEGRAM_WEBHOOK_SECRET` del Worker y el que registraste en `setWebhook`
no coinciden. Vuelve a hacer `setWebhook`.

**El agente recibe 401 al reclamar trabajos**
Su token fue revocado (pasa al registrar la máquina de nuevo). Ejecuta
`npm run setup:machine` en ese ordenador.

**Errores 500 en los logs**
Casi siempre Supabase: URL mal, `service_role` incorrecta o migraciones sin
aplicar.
