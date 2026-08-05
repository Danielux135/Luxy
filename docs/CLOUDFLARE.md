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
```

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
